import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { buildReportCsv, buildReportWorkbook } from '@/lib/shiftReportExport';
import type { ShiftReport } from '@/lib/shiftReport';

const noCache = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noCache });
}
function validDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value);
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
  if (!org || org.length > 100 || !validDate(start) || !validDate(end) || !['json','csv','xlsx'].includes(format)) {
    return failure('Confira a empresa, o período e o formato.', 400);
  }
  const options = {
    unit: query.get('unidade'), specialty: query.get('especialidade'), sector: query.get('posto'),
    doctor: query.get('medico'), state: query.get('situacao'), presence: query.get('presenca'), payment: query.get('pagamento'),
  };
  if (Object.values(options).some(value => value && value.length > 150)) return failure('Um dos filtros é inválido.', 400);
  const { data, error } = await client.rpc('nv_report_shifts', { org, from_date: start, to_date: end, ...options });
  if (error) {
    if (error.code === '42501') return failure('Seu perfil não tem acesso a este relatório ou aos filtros selecionados.', 403);
    if (error.code === '22023') return failure('Confira os filtros e selecione um período de até 366 dias.', 400);
    return failure('Não foi possível gerar o relatório.', 502);
  }
  const report = data as ShiftReport;
  if (report.rows.length > 10_000) return failure('Selecione um período menor ou refine os filtros para exportar até 10.000 plantões.', 422);
  if (format === 'json') return NextResponse.json({
    ...report, total: report.rows.length, rows: report.rows.slice(0, 100),
  }, { headers: noCache });
  const filename = 'nvmed-plantoes-' + start + '-' + end + '.' + format;
  const headers = { ...noCache, 'Content-Disposition': 'attachment; filename="' + filename + '"' };
  if (format === 'csv') return new Response(buildReportCsv(report), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
  return new Response(new Uint8Array(await buildReportWorkbook(report)), { headers: {
    ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } });
}
