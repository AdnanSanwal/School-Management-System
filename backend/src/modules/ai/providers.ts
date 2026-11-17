import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler';
import logger from '../../utils/logger';

/**
 * The AI services a school or the platform can connect. Each call sends one request and
 * returns JSON checked against a schema.
 *
 * Anthropic goes through its own SDK. OpenAI, Gemini and Grok all accept the same
 * "chat completions" request, so they share one small client.
 *
 * The default model is only a starting point shown in the settings screen: providers
 * rename and retire models, so the model name is always editable.
 */

export const PROVIDERS = {
  ANTHROPIC: { label: 'Anthropic (Claude)', defaultModel: 'claude-opus-5-5', keysUrl: 'https://platform.claude.com/settings/keys' },
  OPENAI: { label: 'OpenAI (ChatGPT)', defaultModel: 'gpt-5', keysUrl: 'https://platform.openai.com/api-keys', baseUrl: 'https://api.openai.com/v1' },
  GEMINI: { label: 'Google (Gemini)', defaultModel: 'gemini-2.5-flash', keysUrl: 'https://aistudio.google.com/apikey', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  GROK: { label: 'xAI (Grok)', defaultModel: 'grok-4', keysUrl: 'https://console.x.ai', baseUrl: 'https://api.x.ai/v1' },
} as const;
export type Provider = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as [Provider, ...Provider[]];

export interface AiCall<S extends z.ZodType> {
  provider: Provider;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  schema: S;
  /** The JSON shape, described in words, for services that are not given the schema itself. */
  shape: string;
}
export interface AiResult<T> { data: T; inputTokens: number; outputTokens: number }

const TIMEOUT_MS = 4 * 60 * 1000;
const name = (p: Provider) => PROVIDERS[p].label;

/** What went wrong, in words a school admin can act on. Never includes the key. */
function failure(provider: Provider, status: number | undefined, detail: string): AppError {
  const said = detail ? ` (${detail.replace(/\s+/g, ' ').slice(0, 200)})` : '';
  if (status === 401 || status === 403) return new AppError(`${name(provider)} rejected the API key. Check the key in the AI settings.`, 502);
  if (status === 404) return new AppError(`${name(provider)} does not know this model name. Check the model in the AI settings.${said}`, 502);
  if (status === 429) return new AppError(`${name(provider)} says the account is over its limit or out of credit. Try again later, or check the account's billing.${said}`, 429);
  if (status === 400) return new AppError(`${name(provider)} did not accept the request. The model name may be wrong.${said}`, 502);
  if (status === undefined) return new AppError(`${name(provider)} could not be reached. Check the server's internet connection and try again.`, 502);
  return new AppError(`${name(provider)} could not answer just now. Please try again.${said}`, 502);
}

async function anthropic<S extends z.ZodType>(call: AiCall<S>): Promise<AiResult<z.infer<S>>> {
  const client = new Anthropic({ apiKey: call.apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  try {
    const response = await client.beta.messages.parse({
      model: call.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: call.system,
      messages: [{ role: 'user', content: call.prompt }],
      output_config: { format: zodOutputFormat(call.schema) },
    });
    if (response.stop_reason === 'refusal') throw new AppError('The AI declined this request. Reword the topic or instructions and try again.', 422);
    if (response.stop_reason === 'max_tokens') throw new AppError('That is too much for one draft. Ask for fewer questions and add the rest in the editor.', 422);
    if (!response.parsed_output) throw new AppError('The AI returned an answer that could not be read. Please try again.', 502);
    return { data: response.parsed_output as z.infer<S>, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof Anthropic.APIConnectionError) throw failure('ANTHROPIC', undefined, '');
    if (e instanceof Anthropic.APIError) {
      logger.warn('AI request failed', { provider: 'ANTHROPIC', status: e.status });
      throw failure('ANTHROPIC', e.status, e.status === 401 || e.status === 403 ? '' : e.message);
    }
    throw e;
  }
}

/** JSON out of a reply that may be wrapped in a code fence. */
function readJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? body.slice(start, end + 1) : body);
}

async function chatCompletions<S extends z.ZodType>(call: AiCall<S>): Promise<AiResult<z.infer<S>>> {
  const provider = call.provider as Exclude<Provider, 'ANTHROPIC'>;
  let response: Response;
  try {
    response = await fetch(`${PROVIDERS[provider].baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${call.apiKey}` },
      body: JSON.stringify({
        model: call.model,
        messages: [
          { role: 'system', content: `${call.system}\n\nReply with one JSON object and nothing else, in exactly this shape:\n${call.shape}` },
          { role: 'user', content: call.prompt },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw failure(provider, undefined, '');
  }
  const body = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const detail = (Array.isArray(body) ? body[0] : body)?.error?.message ?? '';
    logger.warn('AI request failed', { provider, status: response.status });
    throw failure(provider, response.status, typeof detail === 'string' ? detail : '');
  }
  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new AppError('That is too much for one draft. Ask for fewer questions and add the rest in the editor.', 422);
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new AppError('The AI declined this request. Reword the topic or instructions and try again.', 422);
  let parsed: z.infer<S>;
  try {
    parsed = call.schema.parse(readJson(String(choice?.message?.content ?? '')));
  } catch {
    throw new AppError('The AI returned an answer that could not be read. Please try again, or choose a more capable model in the AI settings.', 502);
  }
  return { data: parsed, inputTokens: Number(body?.usage?.prompt_tokens) || 0, outputTokens: Number(body?.usage?.completion_tokens) || 0 };
}

/** One request to the chosen service. Throws an AppError a person can act on. */
export function generateJson<S extends z.ZodType>(call: AiCall<S>): Promise<AiResult<z.infer<S>>> {
  return call.provider === 'ANTHROPIC' ? anthropic(call) : chatCompletions(call);
}

/** A tiny request that proves the key and model work. */
export async function testConnection(provider: Provider, model: string, apiKey: string): Promise<void> {
  await generateJson({
    provider, model, apiKey,
    system: 'You are checking that a connection works.',
    prompt: 'Reply with ok set to true.',
    schema: z.object({ ok: z.boolean() }),
    shape: '{ "ok": true }',
  });
}
