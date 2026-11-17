# Test maker

A question bank owned by the school, and exam papers built from it. Web panel only
(Academics, Test maker). Code: `backend/src/modules/testmaker`, `frontend/src/app/testmaker`.

## What it does

**Question bank.** Questions are filed by class, subject, chapter and (optionally) topic.
Six kinds: multiple choice, true or false, fill in the blank, short, long, and match the
columns. Each is written in English, Urdu or both, carries marks, and can have a picture.
Questions are added one at a time or imported from a spreadsheet (copy and paste, or a .csv
file; a template can be downloaded from the import window). An import saves every row or none.

**Papers.** "New paper" asks what the paper is for (class, subject, title, kind of test,
time, medium) and then where its questions come from:

- **From the question bank.** Choose the chapters and how many questions of each kind at how
  many marks. Questions are drawn at random, in turns from each chosen chapter so every
  chapter is represented. The wizard shows how many of each kind the bank holds and warns
  when it holds fewer than asked.
- **Write with AI.** Give the topic or chapters, the board whose pattern to follow, any
  instructions, and how many of each kind. The questions and their answers are written for
  you in English, Urdu or Arabic. See "AI papers" below.
- **Paste a paper.** Paste a paper from WhatsApp, Word or notes. It is split into sections by
  its headings ("MCQs", "Short Questions", and their Urdu equivalents) and question numbers,
  and laid out for printing. The wording is not changed. Marks written after a question,
  such as (3) or [8 marks], are picked up. A pasted paper has no answers: reword a question
  on the paper to mark its answer if you want an answer key.

Whichever way it starts, the paper opens in the same editor.

**Editing.** On the paper a teacher can reword a question, swap it for another from the bank,
change its marks, reorder, remove, write a new question, add a section, and set "attempt any
N of M" for a section. The total is recalculated.

**Printing.** The paper prints from the browser (Print, or Save as PDF) on upright A4 with
the school name and logo, in English, Urdu, Arabic, or English and Urdu side by side. The
heading carries the subject, class, time, total marks and kind of test in boxes, with room
for the pupil's name and roll number. A separate answer key prints
from the same screen. Printing from the browser is what lets Urdu be laid out correctly.

**Formulas.** Anything typed between dollar signs is set as mathematics: `$x^2 + 5x + 6 = 0$`,
`$\frac{3}{4}$`, `$\sqrt{49}$`. This works in questions, choices and answers, in the bank
and on papers. A formula that cannot be read is printed as typed.

## AI papers

AI is off until it is set up for the school: either the school connects its own account
(Settings, AI) or the platform admin provides it with daily and monthly limits (AI for
schools). Anthropic, OpenAI, Google Gemini and xAI Grok are supported. See [AI.md](AI.md).

- **What is sent:** the class name, subject name, kind of test, board, topic and the
  teacher's instructions. Nothing about pupils, staff or the school's name.
- **Limits:** at most 80 questions in one draft, in one language. The draft is not added to
  the question bank.
- **A draft can be wrong.** Read every question and answer before printing.

## Rules worth knowing

- **A paper keeps its own copy of each question.** Rewording a question on a paper does not
  change the bank; editing or deleting a bank question does not change a paper already made.
  A picture stays on disk for as long as any saved paper uses it.
- **Who can use it.** Anyone who may enter marks or manage exams. Office staff who manage
  exams see every class and subject. A teacher sees only the classes and subjects assigned to
  them for the current year (Classes, subject teachers).
- **Who can change what.** A question or paper can be changed or deleted by the person who
  made it, or by office staff who manage exams. Colleagues teaching the same subject can use
  each other's questions and open each other's papers.
- **Editing a question replaces it whole**, including its topic and both languages.
- **Matching questions cannot be imported**; add them one at a time.
- **Arabic is typed in the right-to-left box** (the one labelled Urdu) and printed in a Naskh
  typeface when the paper's medium is Arabic.
- **The board pattern is never printed.** It guides the AI and is a note for the teacher.

## Not included

- A ready-made bank of textbook or past-paper questions. The school builds its own.
- Online tests taken by students, and automatic marking.
- Diagrams drawn for you. Attach a picture to a bank question.
- A downloadable PDF file made by the server. Use the browser's "Save as PDF".
- The mobile app.

Urdu is shown in a Nastaliq typeface when the computer has one installed (Jameel Noori
Nastaleeq, Noto Nastaliq Urdu or Urdu Typesetting); otherwise the browser's default Arabic
script font is used.
