import type { ReportRow, ShiftReport } from './shiftReport.ts';

type Cents = { agreed: bigint; paid: bigint; balance: bigint };
export type ReportAmounts = { agreed: string; paid: string; balance: string };
type Breakdown = ReportAmounts & { name: string; count: number };
type BreakdownMap = Map<string, { name: string; count: number; totals: Cents }>;
const oneReal = BigInt(100);

function cents(value: number | null | undefined) {
  return BigInt(Math.round((value || 0) * 100));
}
const empty = (): Cents => ({ agreed: BigInt(0), paid: BigInt(0), balance: BigInt(0) });
function add(total: Cents, row: ReportRow) {
  total.agreed += cents(row.agreed);
  total.paid += cents(row.paid_amount);
  total.balance += cents(row.balance ?? (row.payment && !['paid', 'cancelled'].includes(row.payment) ? row.agreed : 0));
}
function decimal(value: bigint) {
  return `${value / oneReal}.${String(value % oneReal).padStart(2, '0')}`;
}
function serialize(value: Cents): ReportAmounts {
  return { agreed: decimal(value.agreed), paid: decimal(value.paid), balance: decimal(value.balance) };
}
export function formatReportMoney(value: string) {
  const [whole, fraction = '00'] = value.split('.');
  return `R$ ${BigInt(whole).toLocaleString('pt-BR')},${fraction}`;
}

export function summarizeReport(report: ShiftReport) {
  if (!report.finance) return null;
  const totals = empty();
  const groups = { doctors: new Map() as BreakdownMap, units: new Map() as BreakdownMap, months: new Map() as BreakdownMap };
  function addGroup(group: BreakdownMap, id: string, name: string, row: ReportRow) {
    const entry = group.get(id) || { name, count: 0, totals: empty() };
    add(entry.totals, row);
    entry.count += 1;
    group.set(id, entry);
  }
  for (const row of report.rows) {
    if (!row.payment) continue;
    add(totals, row);
    addGroup(groups.doctors, row.doctor_id || row.doctor || '', row.doctor || 'Médico', row);
    addGroup(groups.units, row.unit_id || row.unit, row.unit, row);
    const month = row.date.slice(0, 7);
    addGroup(groups.months, month, month.slice(5) + '/' + month.slice(0, 4), row);
  }
  const breakdown = (group: BreakdownMap, monthly = false): Breakdown[] => [...group.entries()]
    .sort(([key, a], [otherKey, b]) => monthly ? key.localeCompare(otherKey) : a.name.localeCompare(b.name, 'pt-BR'))
    .map(([, entry]) => ({ name: entry.name, count: entry.count, ...serialize(entry.totals) }));
  return { totals: serialize(totals), doctors: breakdown(groups.doctors), units: breakdown(groups.units), months: breakdown(groups.months, true) };
}
