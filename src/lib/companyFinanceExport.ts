import writeExcelFile, { type Cell, type SheetData } from 'write-excel-file/node';
import { toCsv } from './csv.ts';
import { type CompanyFinanceReport } from './companyFinanceReport.ts';

type Detail = Record<string, string | number | null>;
export interface CompanyExportData {
  shifts: Detail[]; invoices: Detail[]; receipts: Detail[]; payments: Detail[];
  periods: { month: string; closed_at: string | null }[];
}
interface Column { id: string; name: string; kind?: 'money' | 'number' }
interface Table { name: string; columns: Column[]; rows: Detail[] }
const field = (id: string, name: string, kind?: Column['kind']): Column => ({ id, name, kind });
const client = field('client','Contratante'), contract = field('contract','Contrato');
const unit = field('unit','Unidade'), sector = field('sector','Setor'), specialty = field('specialty','Especialidade');
const month = field('month','Competência'), doctor = field('doctor','Médico'), invoiceId = field('invoice_id','ID do faturamento');
const context = [client,contract,unit,sector];
const billed = field('billed','Valor faturado','money'), received = field('received','Repasses recebidos','money'), balance = field('balance','Saldo pendente','money');
const forecast = field('expected_revenue','Receita prevista','money'), revenue = field('assessed_revenue','Receita apurada','money');
const medical = field('medical_cost','Custo médico','money'), gross = field('gross','Resultado bruto','money'), margin = field('margin','Margem bruta (%)','number');
const deductions = field('deductions','Glosas','money'), discounts = field('discounts','Descontos','money'), adjustments = field('adjustments','Ajustes','money');

function cents(value: string | number) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Valor monetário fora do formato esperado.');
  const exact = BigInt(match[2]) * BigInt(100) + BigInt((match[3] || '').padEnd(2,'0'));
  return match[1] ? -exact : exact;
}
function decimal(value: bigint) {
  const exact = value < BigInt(0) ? -value : value;
  return (value < BigInt(0) ? '-' : '') + exact / BigInt(100) + '.' + (exact % BigInt(100)).toString().padStart(2,'0');
}

function summarize(details: Detail[], dimensions: Column[], totals: Column[], result = false): Detail[] {
  const groups = new Map<string, { labels: Detail; values: Map<string, bigint> }>();
  for (const line of details) {
    const entries = dimensions.map(column => [column.id,line[column.id]] as const);
    const key = JSON.stringify(entries);
    const group = groups.get(key) || { labels: Object.fromEntries(entries), values: new Map() };
    groups.set(key,group);
    for (const column of totals) {
      const value = line[column.id];
      if (value != null) group.values.set(column.id,(group.values.get(column.id) || BigInt(0)) + cents(value));
    }
  }
  return Array.from(groups.values(), group => {
    const value = Object.fromEntries(Array.from(group.values, ([id, amount]) => [id,decimal(amount)]));
    if (!result) return { ...group.labels,...value };
    const revenue = group.values.get('assessed_revenue'), cost = group.values.get('medical_cost');
    const diff = revenue == null || cost == null ? null : revenue-cost;
    return { ...group.labels,...value,gross: diff == null ? null : decimal(diff),
      margin: revenue && diff != null ? decimal((diff*BigInt(10000)+(diff < BigInt(0) ? -(revenue/BigInt(2)) : revenue/BigInt(2)))/revenue) : null };
  });
}

function tables(type: CompanyFinanceReport, data: CompanyExportData): Table[] {
  const shifts = data.shifts.map(row => ({ ...row, month: String(row.date).slice(0,7),
    billed: row.issued_on ? row.line_revenue : null }));
  const invoiceRows = data.invoices.map(row => ({ ...row, invoice_id: row.id }));
  const allInvoices: Table = { name: 'Faturamentos', columns: [month,...context,invoiceId,field('document_ref','Documento'),
    field('issued_on','Emissão'),field('due_on','Vencimento'),billed,received,deductions,discounts,adjustments,balance], rows: invoiceRows };
  const paymentTable: Table = { name: 'Pagamentos médicos', columns: [field('paid_on','Data do pagamento'),field('date','Data do plantão'),
    ...context,specialty,doctor,field('shift_id','ID do plantão'),field('id','ID da movimentação'),
    field('amount','Valor da movimentação','money'),field('method','Forma'),field('reversal_of','Pagamento estornado'),field('note','Observações')],
    rows: data.payments.map(row => ({ ...row, method: ({ pix: 'Pix', transfer: 'Transferência', cash: 'Dinheiro', other: 'Outra' } as Record<string,string>)[String(row.method)] || null })) };
  const receiptTable: Table = { name: 'Movimentações de repasses', columns: [month,...context,invoiceId,field('id','ID da movimentação'),
    field('posted_on','Data da movimentação'),field('kind','Tipo'),field('amount','Valor','money'),field('reverses','Movimentação estornada'),field('note','Observações')],
    rows: data.receipts.map(row => ({ ...row, kind: ({ receipt: 'Repasse', deduction: 'Glosa', discount: 'Desconto', reversal: 'Estorno', adjustment: 'Ajuste' } as Record<string,string>)[String(row.kind)] || row.kind })) };
  if (type === 'payments') return [paymentTable];
  if (type === 'receipts') return [receiptTable, allInvoices].filter((item, index) => index === 0 || item.rows.length > 0);
  if (type === 'hours') return [{ name: 'Horas', columns: [field('date','Data'),...context,specialty,doctor,field('id','ID do plantão'),
    field('planned_hours','Horas previstas','number'),field('worked_hours','Horas realizadas','number'),
    field('payable_hours','Horas remuneráveis','number'),field('billable_hours','Horas faturáveis','number')], rows: shifts.map(row => {
      const shift = row as Detail;
      return { ...row,...Object.fromEntries(['planned','worked','payable','billable'].map(key => {
        const minutes = shift[key+'_minutes'];
        return [key+'_hours',minutes == null ? null : Number(minutes)/60];
      })) };
    }) }];
  if (type === 'monthly') {
    const values = [forecast,revenue,billed,medical];
    const summary = summarize(shifts,[month],values,true);
    const months = new Map([...data.periods.map(item => [item.month.slice(0,7), { month: item.month.slice(0,7), closed_at: item.closed_at }] as const),
      ...summary.map(row => [String(row.month),{...row,closed_at: data.periods.find(item => item.month.startsWith(String(row.month)))?.closed_at || null}] as const)]);
    return [{ name: 'Fechamento', columns: [month,field('closed_at','Encerramento'),...values,gross,margin], rows: Array.from(months.values()) },
      allInvoices,receiptTable,paymentTable];
  }
  const group = type === 'billing_client' ? [client] : type === 'billing_contract' ? [client,contract]
    : type === 'billing_unit' ? [unit,sector] : type === 'gross_contract' ? [client,contract] : [unit,specialty];
  const isGross = type.startsWith('gross_');
  const totals = isGross ? [revenue,medical] : [billed,received,deductions,discounts,adjustments,balance];
  const summary = { name: 'Totais', columns: [month,...group,...totals,...(isGross ? [gross,margin] : [])],
    rows: summarize(isGross ? shifts : invoiceRows.map(row => ({ ...row,month: String((row as Detail).month).slice(0,7) })),[month,...group],totals,isGross) };
  if (!isGross) return [summary,allInvoices];
  return [summary,{ name: 'Plantões', columns: [field('date','Data'),...context,specialty,doctor,field('id','ID do plantão'),
    revenue,medical,gross,margin], rows: summarize(shifts,[field('date','Data'),...context,specialty,doctor,field('id','ID do plantão')],totals,true) }];
}

export function companyReportCsv(type: CompanyFinanceReport, data: CompanyExportData) {
  const sections = tables(type,data);
  const columns = Array.from(new Map(sections.flatMap(section => section.columns.map(column => [column.id,column] as const))).values());
  return toCsv(['Seção', ...columns.map(column => column.name)], sections.flatMap(section =>
    section.rows.map(row => [section.name,...columns.map(column => row[column.id] ?? null)])));
}

export function companyReportWorkbook(type: CompanyFinanceReport, data: CompanyExportData) {
  const details = tables(type,data);
  const sheets = details.map(section => {
    const rows: SheetData = [
      section.columns.map(column => ({ value: column.name, type: String, backgroundColor: '#134E4A', textColor: '#FFFFFF', fontWeight: 'bold' })),
      ...section.rows.map(row => section.columns.map((column): Cell => {
        const value = row[column.id];
        if (value == null) return null;
        if (column.kind && String(value).replace(/[^0-9]/g,'').length <= 15) {
          return { value: Number(value), type: Number, format: column.kind === 'money' ? '"R$ " #,##0.00' : '#,##0.00' };
        }
        return { value: String(value), type: String };
      })),
    ];
    return { sheet: section.name, data: rows, stickyRowsCount: 1, columns: section.columns.map(column => ({ width: Math.max(18,column.name.length+5) })) };
  });
  return writeExcelFile(sheets).toBuffer();
}
