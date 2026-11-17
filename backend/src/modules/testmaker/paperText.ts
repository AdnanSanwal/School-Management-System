/**
 * Turns a paper pasted as plain text (from WhatsApp, Word or notes) into sections of
 * questions. Nothing is rewritten: the words stay as the teacher typed them. Answers are
 * not in a pasted paper, so objective questions come out with no answer marked.
 */

export type ParsedType = 'MCQ' | 'TRUE_FALSE' | 'BLANK' | 'SHORT' | 'LONG';

export interface ParsedItem {
  textEn: string | null;
  textUr: string | null;
  options: { en?: string; ur?: string }[] | null;
  answer: null;
  marks: number;
}
export interface ParsedSection { type: ParsedType; title: string; titleUr: string | null; items: ParsedItem[] }

const TITLES: Record<ParsedType, { en: string; ur: string; marks: number }> = {
  MCQ: { en: 'Multiple choice questions', ur: 'کثیر الانتخابی سوالات', marks: 1 },
  TRUE_FALSE: { en: 'True or false', ur: 'درست یا غلط', marks: 1 },
  BLANK: { en: 'Fill in the blanks', ur: 'خالی جگہ پُر کریں', marks: 1 },
  SHORT: { en: 'Short questions', ur: 'مختصر سوالات', marks: 2 },
  LONG: { en: 'Long questions', ur: 'تفصیلی سوالات', marks: 5 },
};

const HEADINGS: [ParsedType, RegExp][] = [
  ['MCQ', /m\.?c\.?q|multiple[\s-]*choice|choose the (correct|right|best)|tick the|objective|کثیر الانتخابی|درست جواب|اختر/i],
  ['TRUE_FALSE', /true\s*(or|and|\/|&)?\s*false|درست\s*(یا|\/)?\s*غلط|صح\s*(أو|او|\/)\s*خطأ/i],
  ['BLANK', /fill\s*(in)?\s*(the)?\s*blanks?|خالی جگہ|املأ الفراغ/i],
  ['LONG', /long\s*(questions?|answers?)|detailed|descriptive|essay|تفصیلی|طویل|انشائیہ/i],
  ['SHORT', /short\s*(questions?|answers?)|brief|subjective|مختصر|قصيرة/i],
];

const RTL = /\p{Script=Arabic}/gu;
/** True when most of the letters are in the Arabic script (Urdu or Arabic). */
export function isRtl(s: string): boolean {
  const rtl = (s.match(RTL) ?? []).length;
  const latin = (s.match(/[A-Za-z]/g) ?? []).length;
  return rtl > latin;
}

const DIGITS = '0-9۰-۹٠-٩';
/** "1.", "12)", "Q3:", "Q.No 4 -", "سوال 5:", "(6)" at the start of a line. */
const QUESTION_START = new RegExp(`^\\s*(?:\\(([${DIGITS}]{1,3})\\)|(?:(?:Q|Ques|Question|سوال(?:\\s*نمبر)?|س)\\s*\\.?\\s*(?:no\\.?)?\\s*)?([${DIGITS}]{1,3})\\s*[.):\\-،۔]+)\\s*(.*)$`, 'i');
/** "(a) ...", "a) ...", "A. ...", "(الف) ...", "(ب) ..." */
const OPTION_MARK = '(?:\\(\\s*(?:[a-fA-F]|الف|ب|ج|د)\\s*\\)|(?:^|\\s)(?:[a-fA-F]|الف|ب|ج|د)\\s*[.)])';
const OPTION_START = new RegExp(`^\\s*${OPTION_MARK}\\s*(.+)$`);
/** "(5)", "[5 marks]", "(2.5 Marks)" at the end of a question. */
const MARKS_END = /\s*[[(]\s*(\d{1,3}(?:\.5)?)\s*(?:marks?|نمبر)?\s*[\])]\s*$/i;

function headingType(line: string): ParsedType | null {
  if (line.length > 90 || QUESTION_START.test(line) || /[?؟]\s*$/.test(line)) return null;
  for (const [type, re] of HEADINGS) if (re.test(line)) return type;
  return null;
}

/** Splits "(a) one (b) two (c) three" into its choices; null when the line has fewer than two. */
function inlineOptions(line: string): { stem: string; options: string[] } | null {
  const marks = [...line.matchAll(new RegExp(OPTION_MARK, 'g'))];
  if (marks.length < 2) return null;
  const options = marks.map((m, i) => line.slice(m.index! + m[0].length, marks[i + 1]?.index ?? line.length).trim()).filter(Boolean);
  if (options.length < 2) return null;
  return { stem: line.slice(0, marks[0].index).trim(), options };
}

interface Raw { text: string; options: string[]; marks: number | null; section: ParsedType | null }

export function parsePaperText(input: string): { sections: ParsedSection[]; questions: number } {
  const lines = input.replace(/\r/g, '').split('\n').map((l) => l.replace(/\t/g, ' ').trim());
  const raws: Raw[] = [];
  let section: ParsedType | null = null;
  let current: Raw | null = null;

  for (const line of lines) {
    if (!line) continue;
    const heading = headingType(line);
    if (heading) { section = heading; current = null; continue; }

    const start = line.match(QUESTION_START);
    if (start) {
      let text = start[3] ?? '';
      const inline = inlineOptions(text);
      current = { text: inline ? inline.stem : text, options: inline ? inline.options : [], marks: null, section };
      text = current.text;
      const m = text.match(MARKS_END);
      if (m) { current.marks = Number(m[1]); current.text = text.replace(MARKS_END, '').trim(); }
      raws.push(current);
      continue;
    }
    if (!current) continue; // school name, date and other lines above the first question

    const inline = inlineOptions(line);
    if (inline && !inline.stem) { current.options.push(...inline.options); continue; }
    const option = line.match(OPTION_START);
    if (option) { current.options.push(option[1].trim()); continue; }
    current.text = current.text ? `${current.text}\n${line}` : line;
  }

  const typed = raws.filter((r) => r.text || r.options.length).map((r) => {
    let type: ParsedType;
    if (r.options.length >= 2) type = 'MCQ';
    else if (r.section && r.section !== 'MCQ') type = r.section;
    else if (/_{3,}|\.{5,}|-{4,}/.test(r.text)) type = 'BLANK';
    else type = 'SHORT';
    return { ...r, type };
  });

  // Questions keep their order; a run of the same kind becomes one section.
  const sections: ParsedSection[] = [];
  for (const r of typed) {
    const side = (s: string) => (isRtl(s) ? { ur: s } : { en: s });
    const item: ParsedItem = {
      textEn: isRtl(r.text) ? null : r.text.slice(0, 4000) || null,
      textUr: isRtl(r.text) ? r.text.slice(0, 4000) : null,
      options: r.type === 'MCQ' ? r.options.slice(0, 6).map((o) => side(o.slice(0, 4000))) : null,
      answer: null,
      marks: r.marks && r.marks >= 0.5 && r.marks <= 100 ? r.marks : TITLES[r.type].marks,
    };
    if (!item.textEn && !item.textUr) item.textEn = '(question text missing)';
    const last = sections[sections.length - 1];
    if (last && last.type === r.type) last.items.push(item);
    else sections.push({ type: r.type, title: TITLES[r.type].en, titleUr: TITLES[r.type].ur, items: [item] });
  }
  return { sections, questions: typed.length };
}
