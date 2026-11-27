import { createClient } from '@/lib/supabase/server';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { workspaceOverviewReader } from '@/lib/supabase/workspaceOverview';
import type { NextRequest } from 'next/server';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get('org'), part = request.nextUrl.searchParams.get('part');
  if (!org || org.length > 150 || !['documents', 'finance', 'all'].includes(part || ''))
    return Response.json({ error: 'Consulta inválida.' }, { status: 400, headers });
  const client = await createClient();
  if (!client) return Response.json({ error: 'Entre novamente para continuar.' }, { status: 401, headers });
  const [user, documentAccess, scheduleAccess, financeAccess] = await Promise.all([
    getAuthorizedUser(client),
    ...['documentos', 'escala', 'financeiro'].map(module => client.rpc('nv_can_action', { org, module, action: 'view' })),
  ]);
  if (!user) return Response.json({ error: 'Entre novamente para continuar.' }, { status: 401, headers });
  if ([documentAccess, scheduleAccess, financeAccess].some(result => result.error))
    return Response.json({ error: 'Não foi possível verificar as permissões.' }, { status: 503, headers });
  const canDocuments = documentAccess.data === true || scheduleAccess.data === true, canFinance = financeAccess.data === true;
  if (part === 'documents' && !canDocuments || part === 'finance' && !canFinance || part === 'all' && !canDocuments && !canFinance)
    return Response.json({ error: 'Consulta indisponível.' }, { status: 403, headers });
  const reader = workspaceOverviewReader(client, org, request.signal, {
    documents: documentAccess.data === true, schedule: scheduleAccess.data === true, finance: part !== 'documents' && canFinance,
  });
  try {
    if (part === 'documents') return Response.json(await reader.documents(), { headers });
    if (part === 'finance') return Response.json(await reader.finance(), { headers });
    // A document error must not hide a valid finance summary.
    const [documents, finance] = await Promise.allSettled([
      canDocuments ? reader.documents() : Promise.resolve(undefined),
      canFinance ? reader.finance() : Promise.resolve(undefined),
    ]);
    return Response.json({ documents: documents.status === 'fulfilled' ? documents.value : null,
      finance: finance.status === 'fulfilled' ? finance.value : null }, { headers });
  } catch {
    return Response.json({ error: 'Não foi possível consultar os indicadores. Tente novamente.' }, { status: 503, headers });
  }
}
