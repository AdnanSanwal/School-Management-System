import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/** A tabular report that can be rendered as Excel or PDF (spec §13 Reports: PDF / Excel). */
export interface Column {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'number' | 'percent';
  width?: number; // relative weight for PDF, characters for Excel
  align?: 'left' | 'right' | 'center';
}

export interface TableReport {
  title: string;
  subtitle?: string;
  school: string;
  currency: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  /** Small print under the table, e.g. a legend. */
  notes?: string[];
}

function fmt(v: unknown, type: Column['type'], currency: string) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money') return `${currency} ${Number(v).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (type === 'percent') return `${Number(v).toFixed(1)}%`;
  if (type === 'number') return Number(v).toLocaleString('en-PK');
  return String(v);
}

export async function toXlsx(r: TableReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School ERP';
  const sheetName = Array.from(r.title).filter(c => !['*', '?', ':', '\\', '/', '[', ']'].includes(c)).join('').slice(0, 31).trim() || 'Report';
  const ws = wb.addWorksheet(sheetName);
  ws.addRow([r.school]).font = { bold: true, size: 14 };
  ws.addRow([r.title]).font = { bold: true, size: 12 };
  if (r.subtitle) ws.addRow([r.subtitle]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFC7D2FE' } } };
  });
  const headerRow = header.number;
  for (const row of r.rows) {
    ws.addRow(r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return null;
      return c.type && c.type !== 'text' ? Number(v) : v;
    }));
  }
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c) => {
      const v = r.totals![c.key];
      return v === null || v === undefined ? null : c.type && c.type !== 'text' && typeof v !== 'string' ? Number(v) : v;
    }));
    t.font = { bold: true };
    t.eachCell((cell) => { cell.border = { top: { style: 'thin' } }; });
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width && c.width > 4 ? c.width : Math.max(c.label.length + 2, c.type === 'text' || !c.type ? 18 : 12);
    if (c.type === 'money') col.numFmt = '#,##0.00';
    if (c.type === 'percent') col.numFmt = '0.0"%"';
    if (c.type === 'number') col.numFmt = '#,##0';
    if (c.align) col.alignment = { horizontal: c.align };
  });
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  for (const n of r.notes ?? []) ws.addRow([n]).font = { italic: true, color: { argb: 'FF6B7280' } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(r: TableReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const landscape = r.columns.length > 8;
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 32, bufferPages: true, info: { Title: r.title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom - 20;
    const fontSize = r.columns.length > 20 ? 6.5 : r.columns.length > 10 ? 7.5 : 9;
    const rowH = fontSize + 9;
    const PAD = 6;
    const align = (c: Column) => c.align ?? (c.type && c.type !== 'text' ? 'right' : 'left');

    // Format every cell up front so columns can be sized to their real content.
    const body = r.rows.map((row) => r.columns.map((c) => fmt(row[c.key], c.type, r.currency)));
    const totals = r.totals ? r.columns.map((c) => fmt(r.totals![c.key], c.type, r.currency)) : null;
    const measure = (text: string, bold = false) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).widthOfString(text);

    // Natural width: widest cell, or the header's longest word (headers may wrap to two lines).
    const natural = r.columns.map((c, i) => Math.max(
      ...c.label.split(' ').map((w) => measure(w, true)),
      ...body.map((row) => measure(row[i])),
      totals ? measure(totals[i], true) : 0,
    ) + PAD + 2);
    const sum = natural.reduce((a, b) => a + b, 0);
    let widths: number[];
    if (sum <= width) {
      // Spare room goes mostly to text columns.
      const weight = r.columns.map((c, i) => natural[i] * (c.type && c.type !== 'text' ? 0.4 : 1));
      const wsum = weight.reduce((a, b) => a + b, 0);
      widths = natural.map((n, i) => n + ((width - sum) * weight[i]) / wsum);
    } else {
      // Keep numbers whole; squeeze text columns (long values get "…").
      const isText = r.columns.map((c) => !c.type || c.type === 'text');
      const fixed = natural.reduce((a, n, i) => a + (isText[i] ? 0 : n), 0);
      const textSum = natural.reduce((a, n, i) => a + (isText[i] ? n : 0), 0);
      const scale = Math.max(0.2, (width - fixed) / (textSum || 1));
      widths = natural.map((n, i) => (isText[i] ? Math.max(24, n * scale) : n));
      const total = widths.reduce((a, b) => a + b, 0);
      if (total > width) widths = widths.map((w) => (w * width) / total);
    }

    const fit = (text: string, w: number, bold: boolean) => {
      if (measure(text, bold) <= w) return text;
      let t = text;
      while (t.length > 1 && measure(`${t}…`, bold) > w) t = t.slice(0, -1);
      return `${t}…`;
    };
    const headerLines = Math.min(2, Math.max(1, ...r.columns.map((c, i) => (measure(c.label, true) > widths[i] - PAD ? 2 : 1))));
    const headerH = rowH + (headerLines - 1) * (fontSize + 2);

    let y = 0;
    const header = (first: boolean) => {
      if (first) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(r.school, left, doc.page.margins.top);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#4338ca').text(r.title);
        if (r.subtitle) doc.font('Helvetica').fontSize(8.5).fillColor('#6b7280').text(r.subtitle);
        doc.moveDown(0.5);
        y = doc.y;
      } else {
        y = doc.page.margins.top;
      }
      doc.rect(left, y, width, headerH).fill('#eef2ff');
      let x = left;
      r.columns.forEach((c, i) => {
        doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#111827')
          .text(c.label, x + PAD / 2, y + 4.5, { width: widths[i] - PAD, align: align(c), height: headerH - 6, lineGap: 1 });
        x += widths[i];
      });
      y += headerH;
    };
    const line = (cells: string[], bold = false, shade = false) => {
      if (y + rowH > bottom) { doc.addPage(); header(false); }
      if (shade) doc.rect(left, y, width, rowH).fill('#f9fafb');
      let x = left;
      r.columns.forEach((c, i) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#111827')
          .text(fit(cells[i], widths[i] - PAD, bold), x + PAD / 2, y + 4.5, { width: widths[i] - PAD, align: align(c), lineBreak: false });
        x += widths[i];
      });
      doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).strokeColor('#e5e7eb').lineWidth(0.4).stroke();
      y += rowH;
    };

    header(true);
    if (!body.length) line(r.columns.map((_, i) => (i === 0 ? 'No data for this period' : '')));
    body.forEach((cells, i) => line(cells, false, i % 2 === 1));
    if (totals) line(totals, true, true);
    if (r.notes?.length) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#6b7280');
      for (const n of r.notes) {
        if (y + 14 > bottom) { doc.addPage(); y = doc.page.margins.top; }
        doc.text(n, left, (y += 8), { width });
        y = doc.y;
      }
    }

    // Footer on every page. Lift the bottom margin while writing it, otherwise pdfkit
    // thinks the text overflows and starts an extra blank page.
    const range = doc.bufferedPageRange();
    const stamp = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#9ca3af')
        .text(`Generated ${stamp} · page ${i + 1} of ${range.count}`, left, doc.page.height - 22, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
