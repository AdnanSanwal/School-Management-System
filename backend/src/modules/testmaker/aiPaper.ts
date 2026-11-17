import { z } from 'zod';
import { generateJson } from '../ai/providers';
import type { ResolvedAi } from '../ai/ai.service';

/**
 * Drafting a paper with AI: the teacher gives the class, subject, topic and how many
 * questions of each kind, and the AI writes them. The draft is opened in the paper editor
 * like any other paper, so a teacher always reads and corrects it before printing.
 *
 * Which AI account is used, and how much a school may use, is decided in modules/ai.
 * What leaves the server: class name, subject name, the topic and the teacher's
 * instructions. No pupil or staff data is sent.
 */

export const AI_LANGUAGES = ['EN', 'UR', 'AR'] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];
export const AI_TYPES = ['MCQ', 'TRUE_FALSE', 'BLANK', 'SHORT', 'LONG', 'MATCH'] as const;
export type AiType = (typeof AI_TYPES)[number];

const draftSchema = z.object({
  sections: z.array(z.object({
    type: z.enum(AI_TYPES),
    title: z.string(),
    items: z.array(z.object({
      text: z.string(),
      /** MCQ only: the choices. Empty for every other kind. */
      options: z.array(z.string()),
      /** MCQ only: position of the correct choice, counting from 0. -1 for every other kind. */
      correctOption: z.number(),
      /** TRUE_FALSE only: whether the statement is true. */
      isTrue: z.boolean(),
      /** BLANK, SHORT, LONG: a model answer. Empty for the other kinds. */
      answer: z.string(),
      /** MATCH only: the pairs that belong together. Empty for every other kind. */
      pairs: z.array(z.object({ left: z.string(), right: z.string() })),
    })),
  })),
});
export type AiDraft = z.infer<typeof draftSchema>;

const LANGUAGE_NAME: Record<AiLanguage, string> = { EN: 'English', UR: 'Urdu (Nastaliq script)', AR: 'Arabic' };
const TYPE_NAME: Record<AiType, string> = {
  MCQ: 'multiple-choice questions with exactly four choices each', TRUE_FALSE: 'true-or-false statements', BLANK: 'fill-in-the-blank sentences (mark the blank with ________)',
  SHORT: 'short-answer questions', LONG: 'long-answer questions', MATCH: 'match-the-columns questions with four or five pairs each',
};

const SYSTEM = `You write school examination papers for teachers in Pakistan.

A teacher gives you the class, subject, the topic or chapters to cover, the kind of test, the board whose paper pattern to follow, and how many questions of each kind to write. Write exactly that many of each kind, in the order given, one section per kind. A teacher will read your draft before it is printed, but assume it may reach pupils, so every question must be correct, unambiguous, and answerable from the stated topic at the stated class level.

How to write the questions:
- Write everything in the language asked for, including section titles. Use the vocabulary of that class's textbooks.
- Stay inside the topic the teacher names. If the topic is broad, spread the questions across it rather than clustering on one part.
- Follow the board's usual style for that class and subject (wording of short and long questions, parts such as "(a)" and "(b)" in long questions where that board uses them). The board is a guide to style only; never print its name.
- Multiple choice: four choices, exactly one correct, the others plausible. Vary which position is correct. No "all of the above".
- Mix easier and harder questions unless the teacher asks otherwise. Do not repeat the same fact in two questions.
- Mathematics and science: write formulas in LaTeX between dollar signs, for example $x^2 + 5x + 6 = 0$ or $\\frac{3}{4}$. Use plain text for everything else.
- Give the answer for every question: the correct choice, true or false, the missing word, or a short model answer a marker could use.
- The teacher's own instructions take priority over these defaults, except the counts and the language.

Do not number the questions and do not put marks in the text; the paper layout adds both.`;

export interface AiRequest {
  className: string;
  subjectName: string;
  language: AiLanguage;
  paperType?: string | null;
  board?: string | null;
  topic: string;
  instructions?: string | null;
  mix: { type: AiType; count: number; marksEach: number }[];
}

/** The JSON the draft comes back in, in words, for services that are not given the schema. */
const SHAPE = `{
  "sections": [
    {
      "type": "MCQ" | "TRUE_FALSE" | "BLANK" | "SHORT" | "LONG" | "MATCH",
      "title": "section heading",
      "items": [
        {
          "text": "the question",
          "options": ["choice", "choice", "choice", "choice"],   // MCQ only, otherwise []
          "correctOption": 0,                                      // MCQ only: position of the correct choice from 0, otherwise -1
          "isTrue": true,                                          // TRUE_FALSE only, otherwise false
          "answer": "model answer",                                // BLANK, SHORT, LONG; otherwise ""
          "pairs": [{ "left": "...", "right": "..." }]            // MATCH only, otherwise []
        }
      ]
    }
  ]
}
Every field must be present in every item.`;

/** Asks the school's AI for the questions. Throws an AppError the teacher can act on. */
export async function draftPaper(ai: ResolvedAi, req: AiRequest): Promise<{ draft: AiDraft; inputTokens: number; outputTokens: number }> {
  const wanted = req.mix.map((m) => `- ${m.count} ${TYPE_NAME[m.type]} (type ${m.type}, ${m.marksEach} mark${m.marksEach === 1 ? '' : 's'} each)`).join('\n');
  const prompt = [
    `Class: ${req.className}`,
    `Subject: ${req.subjectName}`,
    `Language of the paper: ${LANGUAGE_NAME[req.language]}`,
    req.paperType ? `Kind of test: ${req.paperType}` : null,
    req.board ? `Board pattern: ${req.board}` : null,
    `Topic, chapters or syllabus to cover: ${req.topic}`,
    req.instructions ? `Teacher's instructions: ${req.instructions}` : null,
    `\nWrite:\n${wanted}`,
  ].filter(Boolean).join('\n');
  const r = await generateJson({ provider: ai.provider, model: ai.model, apiKey: ai.apiKey, system: SYSTEM, prompt, schema: draftSchema, shape: SHAPE });
  return { draft: r.data, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
}

type Words = { en?: string; ur?: string };

/** The draft in the shape a paper stores, keeping only questions that are complete. */
export function draftToSections(draft: AiDraft, language: AiLanguage, marksOf: (type: AiType) => number) {
  const w = (s: string): Words => (language === 'EN' ? { en: s.trim() } : { ur: s.trim() });
  const sections = [];
  for (const s of draft.sections) {
    const items = [];
    for (const q of s.items) {
      const text = q.text.trim();
      const base = { questionId: null, textEn: language === 'EN' ? text || null : null, textUr: language === 'EN' ? null : text || null, marks: marksOf(s.type), imageKey: null };
      if (s.type === 'MCQ') {
        const options = q.options.map((o) => o.trim()).filter(Boolean).slice(0, 6);
        if (!text || options.length < 2) continue;
        const index = Number.isInteger(q.correctOption) && q.correctOption >= 0 && q.correctOption < options.length ? q.correctOption : null;
        items.push({ ...base, options: options.map(w), answer: index === null ? null : { index } });
      } else if (s.type === 'TRUE_FALSE') {
        if (text) items.push({ ...base, options: null, answer: { value: q.isTrue } });
      } else if (s.type === 'MATCH') {
        const pairs = q.pairs.filter((p) => p.left.trim() && p.right.trim()).slice(0, 10);
        if (pairs.length >= 2) items.push({ ...base, options: pairs.map((p) => ({ left: w(p.left), right: w(p.right) })), answer: null });
      } else if (text) {
        items.push({ ...base, options: null, answer: q.answer.trim() ? w(q.answer.slice(0, 4000)) : null });
      }
    }
    if (items.length) sections.push({ type: s.type, title: s.title.trim().slice(0, 150) || s.type, items });
  }
  return sections;
}
