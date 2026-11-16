# Test maker

A question bank owned by the school, and exam papers built from it. Web panel only
(Academics, Test maker). Code: `backend/src/modules/testmaker`, `frontend/src/app/testmaker`.

## What it does

**Question bank.** Questions are filed by class, subject, chapter and (optionally) topic.
Six kinds: multiple choice, true or false, fill in the blank, short, long, and match the
columns. Each is written in English, Urdu or both, carries marks, and can have a picture.
Questions are added one at a time or imported from a spreadsheet (copy and paste, or a .csv
file; a template can be downloaded from the import window). An import saves every row or none.

**Papers.** "New paper" asks for the class and subject, the chapters to cover, and how many
questions of each kind at how many marks. Questions are drawn at random, in turns from each
chosen chapter so every chapter is represented. The wizard shows how many of each kind the
bank holds and warns when it holds fewer than asked.

**Editing.** On the paper a teacher can reword a question, swap it for another from the bank,
change its marks, reorder, remove, write a new question, add a section, and set "attempt any
N of M" for a section. The total is recalculated.

**Printing.** The paper prints from the browser (Print, or Save as PDF) on upright A4 with
the school name and logo, in English, Urdu, or both side by side. A separate answer key prints
from the same screen. Printing from the browser is what lets Urdu be laid out correctly.

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

## Not included

- A ready-made bank of textbook or past-paper questions. The school builds its own.
- Online tests taken by students, and automatic marking.
- Equation typesetting. Type formulas as text, or attach a picture.
- AI drafting of questions.
- The mobile app.

Urdu is shown in a Nastaliq typeface when the computer has one installed (Jameel Noori
Nastaleeq, Noto Nastaliq Urdu or Urdu Typesetting); otherwise the browser's default Arabic
script font is used.
