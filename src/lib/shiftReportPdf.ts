import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { financeStateLabels } from './financeState.ts';
import { employmentLabel } from './scheduling.ts';
import { formatReportMoney, summarizeReport } from './reportSummary.ts';
import { presenceReportStates, reportFrequencyLabels, reportPeriodLabels, shiftReportStates, type ReportRow, type ShiftReport } from './shiftReport.ts';

export type ReportPdfOptions = { from: string; to: string; filters: string[]; financial: boolean; issuedAt?: Date };

const [height, width] = PageSizes.A4;
const margin = 32;
const contentWidth = width - margin * 2;
const ink = rgb(0.10, 0.16, 0.20);
const muted = rgb(0.28, 0.35, 0.38);
const accent = rgb(0.07, 0.31, 0.26);
const paperTint = rgb(0.94, 0.97, 0.96);
const white = rgb(1, 1, 1);
const size = 8.8;
const lineHeight = 12;
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => value.split('-').reverse().join('/');
const money = (value: number | null | undefined) => value == null ? '–' : brl.format(value);

function textForFont(value: string, characters: Set<number>) {
  return [...value.normalize('NFC').replace(/[\t\r\u00a0]/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')]
    .map(character => character === '\n' || characters.has(character.codePointAt(0)!) ? character : '?').join('');
}

function wrap(value: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const lines: string[] = [];
  const fits = (line: string) => font.widthOfTextAtSize(line, fontSize) <= maxWidth;
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (fits(next)) { line = next; continue; }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (line && !fits(line + character)) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

type Column = { title: string; width: number; field: (row: ReportRow) => string };
function columns(report: ShiftReport): Column[] {
  const core: Column[] = [
    { title: 'Data / horário', width: 85, field: row => [date(row.date), row.start_time + '–' + row.end_time, row.period && reportPeriodLabels[row.period]].filter(Boolean).join('\n') },
    { title: 'Unidade / setor', width: 142, field: row => [row.unit, row.sector, row.specialty].filter(Boolean).join('\n') },
    { title: 'Médico / contratação', width: 123, field: row => [row.doctor || 'Vaga aberta', employmentLabel(row.employment), report.finance && row.crm].filter(Boolean).join('\n') },
    { title: 'Situação', width: 103, field: row => [shiftReportStates[row.status], report.finance && row.payment && financeStateLabels[row.payment],
      report.finance && row.frequency && reportFrequencyLabels[row.frequency]].filter(Boolean).join('\n') },
  ];
  if (report.attendance) core.push({ title: 'Presença', width: 87, field: row => [
    row.presence && presenceReportStates[row.presence], row.check_in && 'E: ' + dateTime.format(new Date(row.check_in)),
    row.check_out && 'S: ' + dateTime.format(new Date(row.check_out)),
  ].filter(Boolean).join('\n') || '–' });
  if (report.finance) core.push(
    { title: 'Combinado', width: 80, field: row => [money(row.agreed), row.due && 'Venc. ' + date(row.due)].filter(Boolean).join('\n') },
    { title: 'Pago', width: 80, field: row => [money(row.paid_amount), row.paid_on && date(row.paid_on)].filter(Boolean).join('\n') },
    { title: 'Saldo pendente', width: 78, field: row => money(row.balance) },
  );
  return core;
}

export async function buildReportPdf(report: ShiftReport, options: ReportPdfOptions) {
  const pdf = await PDFDocument.create();
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyCharacters = new Set(body.getCharacterSet());
  const boldCharacters = new Set(bold.getCharacterSet());
  const title = options.financial ? 'Relatório financeiro de plantões' : 'Relatório de plantões';
  const issued = dateTime.format(options.issuedAt || new Date());
  const organization = report.organization || report.rows[0]?.organization || 'NV Med';
  pdf.setTitle(title);
  pdf.setCreator('NV Med');
  let page: PDFPage;
  let y = 0;

  function draw(value: string, x: number, at: number, fontSize: number, font = body, color = ink) {
    const safe = textForFont(value, font === bold ? boldCharacters : bodyCharacters);
    page.drawText(safe, { x, y: at, size: fontSize, font, color, lineHeight });
  }
  function paragraph(value: string, fontSize = 10, color = muted) {
    for (const line of wrap(textForFont(value, bodyCharacters), body, fontSize, contentWidth)) {
      draw(line, margin, y, fontSize, body, color);
      y -= lineHeight + 2;
    }
  }
  function newPage(section: string) {
    page = pdf.addPage([width, height]);
    y = height - 31;
    draw('NV MED', margin, y, 10, bold, accent);
    y -= 26;
    draw(section, margin, y, 19, bold);
    y -= 20;
    paragraph(organization);
    paragraph(`${date(options.from)} a ${date(options.to)}  ·  Emissão ${issued}`, 9);
    y -= 8;
  }
  function tableHeader(headers: string[], widths: number[]) {
    page.drawRectangle({ x: margin, y: y - 22, width: contentWidth, height: 22, color: accent });
    let x = margin;
    headers.forEach((label, index) => {
      draw(label, x + 6, y - 14, size, bold, white);
      x += widths[index];
    });
    y -= 22;
  }
  function table(section: string, headers: string[], weights: number[], records: string[][]) {
    const totalWidth = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map(value => contentWidth * value / totalWidth);
    tableHeader(headers, widths);
    for (const [index, record] of records.entries()) {
      const lines = record.map((value, column) => wrap(textForFont(value, bodyCharacters), body, size, widths[column] - 12));
      const rowHeight = Math.max(...lines.map(item => item.length)) * lineHeight + 9;
      if (y - rowHeight < 44) {
        newPage(section);
        tableHeader(headers, widths);
      }
      if (index % 2 === 0) page.drawRectangle({ x: margin, y: y - rowHeight, width: contentWidth, height: rowHeight, color: paperTint });
      let x = margin;
      lines.forEach((column, columnIndex) => {
        column.forEach((line, lineIndex) => draw(line, x + 6, y - 13 - lineIndex * lineHeight, size));
        x += widths[columnIndex];
      });
      y -= rowHeight;
    }
  }

  newPage(title);
  paragraph(options.filters.length ? 'Filtros · ' + options.filters.join('  |  ') : 'Filtros · Todos os registros do período', 9);
  const summary = summarizeReport(report);
  paragraph(`${report.rows.length} plantões${summary ? '  ·  Combinado ' + formatReportMoney(summary.totals.agreed)
    + '  ·  Pago ' + formatReportMoney(summary.totals.paid) + '  ·  Saldo pendente ' + formatReportMoney(summary.totals.balance) : ''}`, 10, accent);
  y -= 8;
  const layout = columns(report);
  if (report.rows.length) table(title, layout.map(column => column.title), layout.map(column => column.width), report.rows.map(row => layout.map(column => column.field(row))));
  else paragraph('Nenhum plantão encontrado para os filtros aplicados.');
  if (summary && report.rows.length) {
    newPage('Resumo financeiro');
    for (const [section, items] of [['Totais por médico', summary.doctors], ['Totais por unidade', summary.units], ['Totais por período', summary.months]] as const) {
      if (y < 112) newPage('Resumo financeiro');
      draw(section, margin, y, 12, bold, accent);
      y -= 14;
      table(section, ['Grupo', 'Plantões', 'Valor combinado', 'Valor pago', 'Saldo pendente'], [315, 70, 130, 130, 130],
        items.map(item => [item.name, String(item.count), formatReportMoney(item.agreed), formatReportMoney(item.paid), formatReportMoney(item.balance)]));
      y -= 24;
    }
  }
  const pages = pdf.getPages();
  for (const [index, current] of pages.entries()) {
    current.drawLine({ start: { x: margin, y: 33 }, end: { x: width - margin, y: 33 }, color: paperTint });
    current.drawText(`Página ${index + 1} de ${pages.length}`, { x: width - margin - 78, y: 20, font: body, size: 8, color: muted });
  }
  return pdf.save();
}
