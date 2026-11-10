import writeExcelFile, { type Cell, type SheetData } from 'write-excel-file/node';
import { getCellAddress } from 'write-excel-file/utility';
import { toCsv, type CsvValue } from './csv.ts';
import { shiftReportStates, presenceReportStates, type ReportRow, type ShiftReport } from './shiftReport.ts';
import { financeStateLabels } from './financeState.ts';

const currencyFormat = '"R$" #,##0.00';
const dateFormat = 'dd/mm/yyyy';
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

type Column = {
  label: string;
  width: number;
  field: (item: ReportRow) => string | number | null;
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
];
const status: Column = { label: 'Situação do plantão', width: 24, field: row => shiftReportStates[row.status], highlight: true };
const attendance: Column[] = [
  { label: 'Presença', width: 24, field: row => row.presence && presenceReportStates[row.presence] },
  { label: 'Check-in', width: 20, field: row => row.check_in, kind: 'datetime' },
  { label: 'Check-out', width: 20, field: row => row.check_out, kind: 'datetime' },
];
const payments: Column[] = [
  { label: 'Situação financeira', width: 21, field: row => row.payment && financeStateLabels[row.payment], highlight: true },
  { label: 'Vencimento', width: 15, field: row => row.due, kind: 'date' },
  { label: 'Valor combinado', width: 18, field: row => row.agreed, kind: 'money' },
  { label: 'Pago em', width: 15, field: row => row.paid_on, kind: 'date' },
  { label: 'Valor pago', width: 18, field: row => row.paid_amount, kind: 'money' },
];

function csvValue(column: Column, row: ReportRow): CsvValue {
  const value = column.field(row);
  if (value === null) return '';
  if (column.kind === 'money') return Number(value).toFixed(2).replace('.', ',');
  if (column.kind === 'date') return String(value).split('-').reverse().join('/');
  if (column.kind === 'datetime') return dateTime.format(new Date(value));
  return value;
}

export function buildReportCsv(report: ShiftReport) {
  const columns = [...core, status, ...(report.attendance ? attendance : []), ...(report.finance ? payments : [])];
  return toCsv(columns.map(column => column.label), report.rows.map(row => columns.map(column => csvValue(column, row))));
}

function excelCell(column: Column, row: ReportRow): Cell {
  const value = column.field(row);
  if (value === null) return null;
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

function sheet(name: string, columns: Column[], rows: ReportRow[], total: boolean) {
  const data: SheetData = [
    columns.map(column => ({ value: column.label, type: String, backgroundColor: '#134E4A', textColor: '#FFFFFF', fontWeight: 'bold', height: 24 })),
    ...rows.map(row => columns.map(column => excelCell(column, row))),
  ];
  if (total) data.push(columns.map((column, index) => {
    if (index === 0) return { type: String, value: 'TOTAL', fontWeight: 'bold' };
    if (column.kind !== 'money') return null;
    return { type: Number, value: rows.reduce((sum, row) => sum + Math.round(Number(column.field(row) ?? 0) * 100), 0) / 100,
      format: currencyFormat, fontWeight: 'bold', backgroundColor: '#CCFBF1' };
  }));
  return { sheet: name, data, columns: columns.map(column => ({ width: column.width })), stickyRowsCount: 1, showGridLines: false };
}

export function buildReportWorkbook(report: ShiftReport) {
  const operational = [...core, status, ...(report.attendance ? attendance : [])];
  const financial = report.rows.filter(row => row.payment !== null);
  const sheets = [sheet('Plantões', operational, report.rows, false)];
  const lastRows = [report.rows.length + 1];
  if (report.finance) {
    sheets.push(sheet('Financeiro', [...core, ...payments], financial, true));
    lastRows.push(financial.length + 1);
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
