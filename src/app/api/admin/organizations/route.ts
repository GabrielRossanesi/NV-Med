import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { administrativeMfaMessage, getAdministrativeMfaSession, getAuthorizedUser } from '@/lib/supabase/authorizedUser';

type CleanupResult = {
  complete: boolean;
  auth_user_ids?: string[];
  avatar_paths?: string[];
  document_paths?: string[];
};

const noStore = { 'Cache-Control': 'private, no-store' };
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: noStore });
const databaseStatuses: Record<string, number> = { '42501': 403, '22023': 400, PT404: 404, PT409: 409 };

async function authorize(request: NextRequest) {
  if (request.method !== 'GET' && request.headers.get('origin') !== request.nextUrl.origin) throw new Error('Origem inválida.');
  const client = await createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const user = await getAuthorizedUser(client);
  if (!user) throw new Error('Entre novamente.');
  const { data: profile } = await client.from('user_accounts').select('type,role,status').eq('auth_user_id', user.id).single();
  if (profile?.type !== 'saas_admin' || profile.status !== 'active' || profile.role !== 'CEO') throw new Error('Somente o CEO pode excluir empresas.');
  const mfaSession = await getAdministrativeMfaSession(client);
  if (!mfaSession) throw new Error(administrativeMfaMessage);
  return { user, mfaSession };
}

export async function GET(request: NextRequest) {
  try {
    const authorization = await authorize(request);
    const admin = createAdminClient();
    if (!admin) return reply({ error: 'Administração de empresas indisponível.' }, 503);
    const { data, error } = await admin.rpc('nv_pending_organization_cleanups', {
      actor_auth: authorization.user.id, actor_session: authorization.mfaSession,
    });
    return error ? reply({ error: 'Não foi possível consultar as exclusões pendentes.' }, 502) : reply({ jobs: data });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Acesso negado.' }, 403);
  }
}

async function cleanOrganization(admin: NonNullable<ReturnType<typeof createAdminClient>>, id: string, lease: string) {
  const reconcile = (release = false) => admin.rpc('nv_reconcile_organization_cleanup', { target_id: id, lease, release_lease: release });
  try {
    for (let range = 0; range < 2; range++) {
      const { data, error } = await reconcile();
      if (error || !data) break;
      const batch: CleanupResult = data;
      if (batch.complete) return true;
      const documentPaths = batch.document_paths ?? [];
      const avatarPaths = batch.avatar_paths ?? [];
      const removals = await Promise.all([
        documentPaths.length && admin.storage.from('medical-documents').remove(documentPaths),
        avatarPaths.length && admin.storage.from('profile-avatars').remove(avatarPaths),
      ]);
      if (removals.some(result => result && result.error)) break;
      for (const id of batch.auth_user_ids ?? []) {
        const { error: authError } = await admin.auth.admin.deleteUser(id);
        if (authError && authError.status !== 404) throw authError;
      }
    }
  } catch { /* A later attempt reconciles work already committed by Storage or Auth. */ }
  const { data, error } = await reconcile(true);
  return !error && data?.complete === true;
}

export async function DELETE(request: NextRequest) {
  let authorization;
  try { authorization = await authorize(request); } catch (error) { return reply({ error: error instanceof Error ? error.message : 'Acesso negado.' }, 403); }
  const admin = createAdminClient();
  if (!admin) return reply({ error: 'A administração de empresas não está configurada no servidor.' }, 503);

  try {
    const input = await request.json().catch(() => null);
    if (typeof input?.id !== 'string' || typeof input?.confirmation !== 'string' || input.confirmation.length > 200) {
      return reply({ error: 'Confira a empresa e digite o nome para confirmar.' }, 400);
    }
    const { data, error } = await admin.rpc('nv_delete_organization', {
      target_id: input.id, actor_auth: authorization.user.id, actor_session: authorization.mfaSession, confirmation: input.confirmation,
    });
    if (error) {
      const status = databaseStatuses[error.code];
      return reply({ error: status ? error.message : 'Não foi possível iniciar a exclusão da empresa.' }, status || 502);
    }
    if (data?.complete || (typeof data?.lease === 'string' && await cleanOrganization(admin, input.id, data.lease))) {
      return reply({ deleted: true });
    }
    return reply({ error: 'A limpeza ainda está pendente. Retome em Exclusões pendentes.', pending: true }, 409);
  } catch {
    return reply({ error: 'Não foi possível confirmar a exclusão. Confira Exclusões pendentes antes de tentar novamente.' }, 502);
  }
}
