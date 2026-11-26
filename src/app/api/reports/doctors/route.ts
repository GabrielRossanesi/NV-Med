import { createClient } from '@/lib/supabase/server';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { doctorDirectoryCsv, doctorDirectoryWorkbook } from '@/lib/doctorDirectoryExport';
import type { DirectoryDoctor } from '@/lib/doctorDirectory';
import type { NextRequest } from 'next/server';
import { readBoundedBody } from '@/lib/documentAccess';

export const runtime = 'nodejs';
const noCache = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: noCache });
export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return error('Origem indisponível.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return error('Envie uma solicitação válida.', 415);
  if (Number(request.headers.get('content-length') || 0) > 32_000) return error('Seleção muito extensa.', 413);
  const bytes = await readBoundedBody(request, 32_000).catch(() => null);
  if (!bytes) return error('Seleção muito extensa.', 413);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return error('Confira a solicitação.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error('Confira a solicitação.', 400);
  const { org, filters, ids, requestId, format } = body;
  if (typeof org !== 'string' || org.length > 150 || !['csv', 'xlsx'].includes(format) || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)
    || (ids !== null && (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')))) return error('Confira os dados da exportação.', 400);
  const client = await createClient();
  if (!client) return error('Exportação indisponível.', 503);
  if (!await getAuthorizedUser(client)) return error('Entre novamente para exportar.', 401);
  const result = await client.rpc('nv_export_doctor_directory', { org, filters, ids, request_id: requestId });
  if (result.error) return error(result.error.code === '42501' ? 'A exportação exige permissão e verificação em duas etapas.' : 'Não foi possível exportar. Confira os filtros e tente novamente.', result.error.code === '42501' ? 403 : 400);
  try {
    const data = result.data as DirectoryDoctor[];
    const content = format === 'csv' ? doctorDirectoryCsv(data) : new Uint8Array(await doctorDirectoryWorkbook(data));
    if ((typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength) > 4_000_000) return error('Refine os filtros ou exporte uma seleção menor para gerar um arquivo de até 4 MB.', 413);
    return new Response(content, { headers: { ...noCache, 'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="nvmed-medicos.${format}"` } });
  } catch { return error('Não foi possível preparar o arquivo.', 502); }
}
