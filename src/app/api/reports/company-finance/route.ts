import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { companyReportCsv, companyReportWorkbook, type CompanyExportData } from '@/lib/companyFinanceExport';
import { cashFinanceReports, companyFinanceFilterKeys, companyFinanceReports, type CompanyFinanceReport } from '@/lib/companyFinanceReport';

const noCache = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noCache });
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0,10) === value;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const org = query.get('empresa') || '';
  const from_date = query.get('inicio') || '';
  const to_date = query.get('fim') || '';
  const regime = query.get('regime') || 'competence';
  const report = (query.get('relatorio') || 'monthly') as CompanyFinanceReport;
  const format = query.get('format') || 'csv';
  const filters = Object.fromEntries(companyFinanceFilterKeys.map(key => [key, query.get(key) || ''] as const).filter(([,value]) => value));
  if (!org || org.length > 100 || !validDate(from_date) || !validDate(to_date) || !['cash','competence'].includes(regime)
    || !Object.hasOwn(companyFinanceReports, report) || !['csv','xlsx'].includes(format)
    || Object.values(filters).some(value => value.length > 150) || (regime === 'cash' && !cashFinanceReports.includes(report))) {
    return error('Confira a empresa, o período e o relatório.', 400);
  }
  const client = await createClient();
  if (!client) return error('Relatórios indisponíveis.', 503);
  if (!await getAuthorizedUser(client)) return error('Entre novamente para exportar.', 401);
  const { data, error: failure } = await client.rpc('nv_finance_company_report', { org, from_date, to_date, regime, filters, exporting: true });
  if (failure) {
    if (failure.code === '42501') return error('Seu perfil não tem permissão para exportar este relatório.', 403);
    if (failure.code === '22023') return error(failure.message, 400);
    return error('Não foi possível consultar o relatório.', 502);
  }
  const headers = { ...noCache, 'Content-Disposition': 'attachment; filename="nvmed-' + report + '-' + from_date + '-' + to_date + '.' + format + '"' };
  try {
    if (format === 'csv') return new Response(companyReportCsv(report, data as CompanyExportData), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
    return new Response(new Uint8Array(await companyReportWorkbook(report, data as CompanyExportData)), { headers: {
      ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } });
  } catch {
    return error('Não foi possível preparar o arquivo.', 502);
  }
}
