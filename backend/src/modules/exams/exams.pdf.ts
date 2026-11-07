import PDFDocument from 'pdfkit';
import type { ReportCard } from './exams.service';

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const ACCENT = '#4338ca';
const BAD = '#b91c1c';

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Renders one student's report card as an A4 PDF. */
export function renderReportCard(rc: ReportCard): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${rc.student.name} — ${rc.exam.name}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // ─── Header ───
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(rc.school.name, { align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text([rc.school.address, rc.school.phone].filter(Boolean).join(' · ') || ' ', { align: 'center' });
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ACCENT)
      .text(`REPORT CARD — ${rc.exam.name.toUpperCase()} ${rc.exam.academicYear}`, { align: 'center', characterSpacing: 0.5 });
    if (rc.exam.status !== 'PUBLISHED') {
      doc.moveDown(0.2).font('Helvetica-Oblique').fontSize(9).fillColor(BAD).text('Provisional — results not yet published', { align: 'center' });
    }
    doc.moveDown(0.8);

    // ─── Student block ───
    const info: [string, string][] = [
      ['Student', rc.student.name], ['Admission no.', rc.student.admissionNo],
      ['Class', rc.section.name], ['Roll no.', rc.student.rollNo ?? '—'],
      ['Parent / guardian', rc.student.guardian ?? '—'], ['Class teacher', rc.section.classTeacher ?? '—'],
    ];
    const colW = width / 2;
    let y = doc.y;
    info.forEach(([k, v], i) => {
      const x = left + (i % 2) * colW;
      if (i % 2 === 0 && i > 0) y += 18;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, x, y, { width: 90 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(v, x + 92, y - 1, { width: colW - 100 });
    });
    y += 28;

    // ─── Subjects table ───
    const cols = [
      { h: 'Subject', w: 0.30, a: 'left' as const },
      { h: 'Max', w: 0.10, a: 'right' as const },
      { h: 'Pass', w: 0.10, a: 'right' as const },
      { h: 'Obtained', w: 0.14, a: 'right' as const },
      { h: '%', w: 0.12, a: 'right' as const },
      { h: 'Grade', w: 0.10, a: 'center' as const },
      { h: 'Result', w: 0.14, a: 'center' as const },
    ];
    const row = (cells: string[], opts: { bold?: boolean; fill?: string; colors?: (string | undefined)[] } = {}) => {
      const h = 20;
      if (opts.fill) doc.rect(left, y, width, h).fill(opts.fill);
      let x = left;
      cells.forEach((c, i) => {
        const w = cols[i].w * width;
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(opts.colors?.[i] ?? INK)
          .text(c, x + 6, y + 6, { width: w - 12, align: cols[i].a, lineBreak: false, ellipsis: true });
        x += w;
      });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).strokeColor(LINE).lineWidth(0.5).stroke();
      y += h;
    };
    row(cols.map((c) => c.h), { bold: true, fill: '#eef2ff' });
    for (const s of rc.result.subjects) {
      const res = s.passed === null ? '—' : s.isAbsent ? 'Absent' : s.passed ? 'Pass' : 'Fail';
      row([
        s.subject, fmt(s.totalMarks), fmt(s.passingMarks),
        s.isAbsent ? 'AB' : fmt(s.obtained), fmt(s.percent), s.grade ?? '—', res,
      ], { colors: [undefined, MUTED, MUTED, undefined, undefined, undefined, s.passed === false ? BAD : undefined] });
    }
    row(['Total', fmt(rc.result.maxMarks), '', fmt(rc.result.obtained), fmt(rc.result.percent), rc.result.grade ?? '—',
      rc.result.passed === null ? 'Incomplete' : rc.result.passed ? 'PASS' : 'FAIL'],
    { bold: true, fill: '#f9fafb', colors: [undefined, undefined, undefined, undefined, undefined, ACCENT, rc.result.passed === false ? BAD : ACCENT] });

    // ─── Summary ───
    y += 16;
    const summary: [string, string][] = [
      ['Percentage', rc.result.percent !== null ? `${fmt(rc.result.percent)}%` : '—'],
      ['Grade', rc.result.grade ? `${rc.result.grade}${rc.result.gradeRemark ? ` (${rc.result.gradeRemark})` : ''}` : '—'],
      ['Position in class', rc.result.position ? `${rc.result.position} of ${rc.rankedCount}` : '—'],
      ['Class average', rc.classAverage !== null ? `${fmt(rc.classAverage)}%` : '—'],
      ['Attendance', rc.attendance.percent !== null ? `${rc.attendance.percent}% of ${rc.attendance.total} days` : '—'],
    ];
    summary.forEach(([k, v], i) => {
      const x = left + (i % 3) * (width / 3);
      if (i % 3 === 0 && i > 0) y += 34;
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k.toUpperCase(), x, y, { width: width / 3 - 8, characterSpacing: 0.3 });
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(v, x, y + 11, { width: width / 3 - 8 });
    });
    y += 44;
    if (rc.result.failedSubjects.length) {
      doc.font('Helvetica').fontSize(9.5).fillColor(BAD).text(`Needs improvement in: ${rc.result.failedSubjects.join(', ')}`, left, y, { width });
      y = doc.y + 8;
    }

    // ─── Remarks ───
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text("Class teacher's remarks", left, y);
    doc.rect(left, doc.y + 4, width, 54).strokeColor(LINE).lineWidth(0.8).stroke();
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(rc.remarks ?? '', left + 8, doc.y + 10, { width: width - 16, height: 44 });

    // ─── Signatures ───
    const sigY = doc.page.height - doc.page.margins.bottom - 70;
    ['Class teacher', 'Principal', 'Parent / guardian'].forEach((label, i) => {
      const x = left + i * (width / 3) + 10;
      doc.moveTo(x, sigY).lineTo(x + width / 3 - 30, sigY).strokeColor(MUTED).lineWidth(0.6).stroke();
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, x, sigY + 5, { width: width / 3 - 30, align: 'center' });
    });

    // ─── Grade key ───
    if (rc.scale.length) {
      const key = [...rc.scale].sort((a, b) => b.minPercent - a.minPercent).map((g) => `${g.grade} ${fmt(g.minPercent)}–${fmt(g.maxPercent)}%`).join('   ');
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Grades: ${key}`, left, sigY + 30, { width, align: 'center' });
    }
    doc.end();
  });
}
