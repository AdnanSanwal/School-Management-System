/**
 * The AI services are answered by a stand-in fetch, so nothing leaves the machine.
 *   npx jest src/__tests__/unit/aiProviders
 */
import { z } from 'zod';
import { DEADLINE_MS, generateJson } from '../../modules/ai/providers';

const call = { provider: 'OPENAI' as const, model: 'm', apiKey: 'k', system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), shape: '{ "ok": true }' };
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('AI providers', () => {
  it('the whole call ends before the browser stops waiting (5 minutes)', () => {
    expect(DEADLINE_MS).toBeLessThan(5 * 60 * 1000);
  });

  it('a call that runs out of time says so', async () => {
    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    await expect(generateJson(call)).rejects.toMatchObject({ statusCode: 504, message: expect.stringMatching(/took too long/) });
  });

  it('reads JSON, also when wrapped in a code fence, and reports what was used', async () => {
    const reply = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }) });
    global.fetch = jest.fn().mockResolvedValue(reply('```json\n{ "ok": true }\n```'));
    await expect(generateJson(call)).resolves.toEqual({ data: { ok: true }, inputTokens: 12, outputTokens: 3 });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer k');
  });

  it('a rejected key and an unknown model come back as plain messages, without the key', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided: k' } }) });
    const denied = await generateJson(call).catch((e) => e);
    expect(denied.message).toMatch(/rejected the API key/);
    expect(denied.message).not.toContain('Incorrect API key');
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: 'model m does not exist' } }) });
    await expect(generateJson(call)).rejects.toMatchObject({ message: expect.stringMatching(/does not know this model/) });
  });
});
