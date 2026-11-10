import writeExcelFile, { type Cell, type SheetData } from 'write-excel-file/node';
import { getCellAddress } from 'write-excel-file/utility';
import { toCsv, type CsvValue } from './csv.ts';
import { shiftReportStates, presenceReportStates, reportFrequencyLabels, reportPeriodLabels, type ReportRow, type ShiftReport } from './shiftReport.ts';
import { financeStateLabels } from './financeState.ts';
import { formatReportMoney, summarizeReport } from './reportSummary.ts';

const currencyFormat = '"R$" #,##0.00';
const dateFormat = 'dd/mm/yyyy';
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

type Column = {
  label: string;
  width: number;
  field: (item: ReportRow) => string | number | null | undefined;
  total?: 'agreed' | 'paid' | 'balance';
  kind?: 'date' | 'money' | 'datetime';
  highlight?: boolean;
};

const core: Column[] = [
  { label: 'Empresa', width: 27, field: row => row.organization },
  { label: 'Unidade', width: 28, field: row => row.unit },
  { label: 'Posto', width: 24, field: row => row.sector },
  { label: 'Especialidade', width: 24, field: row => row.specialty },
  { label: 'Médico', width: 32, field: row => row.doctor },
  { label: 'Data', width: 13, field: row => row.date, kind: 'date' },
  { label: 'Início', width: 12, field: row => row.start_time },
  { label: 'Fim', width: 12, field: row => row.end_time },
  { label: 'Turno', width: 13, field: row => row.period && reportPeriodLabels[row.period] },
];
const status: Column = { label: 'Situação do plantão', width: 24, field: row => shiftReportStates[row.status], highlight: true };
const attendance: Column[] = [
  { label: 'Presença', width: 24, field: row => row.presence && presenceReportStates[row.presence] },
  { label: 'Check-in', width: 20, field: row => row.check_in, kind: 'datetime' },
  { label: 'Check-out', width: 20, field: row => row.check_out, kind: 'datetime' },
];
const payments: Column[] = [
  { label: 'CRM', width: 15, field: row => row.crm },
  { label: 'Vínculo', width: 15, field: row => row.employment && ({ clt: 'CLT', concursado: 'Concursado', pj: 'PJ' }[row.employment] || row.employment) },
  { label: 'Empregador', width: 25, field: row => row.employer },
  { label: 'Modalidade de pagamento', width: 22, field: row => row.frequency && reportFrequencyLabels[row.frequency] },
  { label: 'Situação financeira', width: 21, field: row => row.payment && financeStateLabels[row.payment], highlight: true },
  { label: 'Vencimento', width: 15, field: row => row.due, kind: 'date' },
  { label: 'Valor combinado', width: 18, field: row => row.agreed, kind: 'money', total: 'agreed' },
  { label: 'Pago em', width: 15, field: row => row.paid_on, kind: 'date' },
  { label: 'Valor pago', width: 18, field: row => row.paid_amount, kind: 'money', total: 'paid' },
  { label: 'Saldo pendente', width: 18, field: row => row.balance, kind: 'money', total: 'balance' },
];

function csvValue(column: Column, row: ReportRow): CsvValue {
  const value = column.field(row);
  if (value == null) return '';
  if (column.kind === 'money') return Number(value).toFixed(2).replace('.', ',');
  if (column.kind === 'date') return String(value).split('-').reverse().join('/');
  if (column.kind === 'datetime') return dateTime.format(new Date(value));
  return value;
}

export function buildReportCsv(report: ShiftReport) {
  const columns = [...core, status, ...(report.attendance ? attendance : []), ...(report.finance ? payments : [])];
  const rows = report.rows.map(row => columns.map(column => csvValue(column, row)));
  const summary = summarizeReport(report);
  if (summary) {
    const totals = (label: string, name: string, amounts: typeof summary.totals) => columns.map((column, index) =>
      index === 0 ? label : index === 1 ? name : column.total ? amounts[column.total].replace('.', ',') : '');
    rows.push(totals('TOTAL', '', summary.totals));
    for (const row of summary.doctors) rows.push(totals('Total por médico', row.name, row));
    for (const row of summary.units) rows.push(totals('Total por unidade', row.name, row));
    for (const row of summary.months) rows.push(totals('Total por período', row.name, row));
  }
  return toCsv(columns.map(column => column.label), rows);
}

function excelCell(column: Column, row: ReportRow): Cell {
  const value = column.field(row);
  if (value == null) return null;
  if (column.kind === 'money') return { type: Number, value: Number(value), format: currencyFormat };
  if (column.kind === 'date') return { type: Date, value: new Date(String(value) + 'T00:00:00Z'), format: dateFormat };
  if (column.kind === 'datetime') return { type: String, value: dateTime.format(new Date(value)) };
  if (column.highlight) {
    const danger = value === 'Vaga aberta' || value === 'Em atraso';
    const warning = value === 'Troca solicitada' || value === 'Aguardando confirmação';
    const success = value === 'Confirmado' || value === 'Pago';
    return {
      type: String, value: String(value), fontWeight: 'bold',
      textColor: danger ? '#991B1B' : warning ? '#854D0E' : success ? '#166534' : '#475569',
      backgroundColor: danger ? '#FEE2E2' : warning ? '#FEF3C7' : success ? '#DCFCE7' : '#F1F5F9',
    };
  }
  // User-controlled strings stay text, including leading formula characters.
  return { type: String, value: String(value) };
}

function moneyTotal(value: string): Cell {
  return value.replace('.', '').length <= 15
    ? { type: Number, value: Number(value), format: currencyFormat, fontWeight: 'bold' }
    : { type: String, value: formatReportMoney(value), fontWeight: 'bold' };
}
function sheet(name: string, columns: Column[], rows: ReportRow[], totals?: NonNullable<ReturnType<typeof summarizeReport>>['totals']) {
  const data: SheetData = [
    columns.map(column => ({ value: column.label, type: String, backgroundColor: '#134E4A', textColor: '#FFFFFF', fontWeight: 'bold', height: 24 })),
    ...rows.map(row => columns.map(column => excelCell(column, row))),
  ];
  if (totals) data.push(columns.map((column, index) =>
    index === 0 ? { type: String, value: 'TOTAL', fontWeight: 'bold' } : column.total ? moneyTotal(totals[column.total]) : null));
  return { sheet: name, data, columns: columns.map(column => ({ width: column.width })), stickyRowsCount: 1, showGridLines: false };
}

export function buildReportWorkbook(report: ShiftReport) {
  const operational = [...core, status, ...(report.attendance ? attendance : [])];
  const financial = report.rows.filter(row => Boolean(row.payment));
  const sheets = [sheet('Plantões', operational, report.rows)];
  const lastRows = [report.rows.length + 1];
  const summary = summarizeReport(report);
  if (summary) {
    sheets.push(sheet('Financeiro', [...core, ...payments], financial, summary.totals));
    lastRows.push(financial.length + 1);
    for (const [name, items] of [['Por médico', summary.doctors], ['Por unidade', summary.units], ['Por período', summary.months]] as const) {
      const data: SheetData = [
        ['Grupo', 'Plantões', 'Valor combinado', 'Valor pago', 'Saldo pendente'].map(value =>
          ({ type: String, value, backgroundColor: '#134E4A', textColor: '#FFFFFF', fontWeight: 'bold', height: 24 })),
        ...items.map(item => [{ type: String, value: item.name }, { type: Number, value: item.count }, moneyTotal(item.agreed), moneyTotal(item.paid), moneyTotal(item.balance)] as Cell[]),
        [{ type: String, value: 'TOTAL', fontWeight: 'bold' }, { type: Number, value: financial.length }, moneyTotal(summary.totals.agreed), moneyTotal(summary.totals.paid), moneyTotal(summary.totals.balance)],
      ];
      sheets.push({ sheet: name, data, columns: [36, 12, 20, 20, 20].map(width => ({ width })), stickyRowsCount: 1, showGridLines: false });
      lastRows.push(items.length + 1);
    }
  }
  return writeExcelFile(sheets, {
    features: [{
      files: { transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform(xml, _options, { sheetIndex }) {
            const lastCell = getCellAddress(lastRows[sheetIndex] - 1, sheets[sheetIndex].columns.length - 1);
            return xml.replace('</sheetData>', '</sheetData><autoFilter ref="A1:' + lastCell + '"/>');
          },
        },
      } },
    }],
  }).toBuffer();
}
