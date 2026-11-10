import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { buildReportCsv, buildReportWorkbook } from '@/lib/shiftReportExport';
import { buildReportPdf } from '@/lib/shiftReportPdf';
import { summarizeReport } from '@/lib/reportSummary';
import { financeStateLabels } from '@/lib/financeState';
import {
  presenceReportStates, reportFilterKeys, reportFrequencyLabels, reportPeriodLabels, shiftReportStates,
  type ReportCatalog, type ShiftReport,
} from '@/lib/shiftReport';

const noCache = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noCache });
}
function validDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value);
}
const date = (value: string) => value.split('-').reverse().join('/');
const labels = (values: Record<string, string>, value: string) => values[value] || value;
function describe(filters: Record<string, string>, catalog?: ReportCatalog) {
  const entries = [
    ['Unidade', filters.unit && (catalog?.units.find(item => item.id === filters.unit)?.name || filters.unit)],
    ['Setor', filters.sector && (catalog?.sectors.find(item => item.id === filters.sector)?.name || filters.sector)],
    ['Médico', filters.doctor && (catalog?.doctors.find(item => item.id === filters.doctor)?.name || filters.doctor)],
    ['Especialidade', filters.specialty], ['Plantão', filters.shift_id],
    ['Início a partir de', filters.start_hour], ['Fim até', filters.end_hour],
    ['Turno', filters.period && labels(reportPeriodLabels, filters.period)],
    ['Situação do plantão', filters.state && labels({ active: 'Ativos', ...shiftReportStates }, filters.state)],
    ['Presença', filters.presence && labels(presenceReportStates, filters.presence)],
    ['Pagamento', filters.payment && labels({ unpaid: 'Aguardando pagamento', ...financeStateLabels }, filters.payment)],
    ['Modalidade', filters.frequency && labels(reportFrequencyLabels, filters.frequency)],
    ['Vencimento de', filters.due_from && date(filters.due_from)], ['Vencimento até', filters.due_to && date(filters.due_to)],
    ['Pagamento de', filters.paid_from && date(filters.paid_from)], ['Pagamento até', filters.paid_to && date(filters.paid_to)],
  ];
  return entries.filter(([, value]) => value).map(([label, value]) => label + ': ' + value);
}

export async function GET(request: NextRequest) {
  const client = await createClient();
  if (!client) return failure('Relatórios indisponíveis.', 503);
  const user = await getAuthorizedUser(client);
  if (!user) return failure('Entre novamente para abrir o relatório.', 401);
  const query = request.nextUrl.searchParams;
  const format = query.get('format') || 'json';
  const org = query.get('empresa');
  const start = query.get('inicio');
  const end = query.get('fim');
  const mode = query.get('modo') || 'operacional';
  const financial = mode === 'financeiro';
  if (!org || org.length > 100 || !validDate(start) || !validDate(end)
    || !['operacional', 'financeiro'].includes(mode) || !['json', 'csv', 'xlsx', 'pdf'].includes(format)) {
    return failure('Confira a empresa, o período e o formato.', 400);
  }
  const filters: Record<string, string> = {};
  for (const [key, parameter] of Object.entries(reportFilterKeys)) {
    const value = query.get(key);
    if (value) filters[parameter] = value;
  }
  if (Object.values(filters).some(value => value.length > 150)) return failure('Um dos filtros é inválido.', 400);
  const { data, error } = await client.rpc('nv_report_filtered_shifts', {
    org, from_date: start, to_date: end, filters, financial_only: financial,
  });
  if (error) {
    if (error.code === '42501') return failure('Seu perfil não tem acesso a este relatório ou aos filtros selecionados.', 403);
    if (error.code === '22023') return failure(financial ? 'Confira as datas e os filtros selecionados.' : 'Confira os filtros e selecione um período de até 366 dias.', 400);
    return failure('Não foi possível gerar o relatório.', 502);
  }
  const report = data as ShiftReport;
  if (report.rows.length > 10_000) return failure('Selecione um período menor ou refine os filtros para exportar até 10.000 plantões.', 422);
  if (format === 'json') return NextResponse.json({
    ...report, summary: summarizeReport(report), total: report.rows.length, rows: report.rows.slice(0, 100),
  }, { headers: noCache });
  const filename = 'nvmed-' + (financial ? 'financeiro-' : 'plantoes-') + start + '-' + end + '.' + format;
  const headers = { ...noCache, 'Content-Disposition': 'attachment; filename="' + filename + '"' };
  try {
    if (format === 'csv') return new Response(buildReportCsv(report), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
    if (format === 'pdf') {
      let catalog: ReportCatalog | undefined;
      if (filters.unit || filters.sector || filters.doctor) {
        const lookup = await client.rpc('nv_report_catalog', { org, financial_only: financial });
        if (lookup.error) return failure('Não foi possível verificar os filtros do relatório.', lookup.error.code === '42501' ? 403 : 502);
        catalog = lookup.data as ReportCatalog;
      }
      const pdf = await buildReportPdf(report, { from: start, to: end, filters: describe(filters, catalog), financial });
      return new Response(new Uint8Array(pdf), { headers: { ...headers, 'Content-Type': 'application/pdf' } });
    }
    return new Response(new Uint8Array(await buildReportWorkbook(report)), { headers: {
      ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } });
  } catch {
    return failure('Não foi possível preparar o arquivo de exportação.', 502);
  }
}
