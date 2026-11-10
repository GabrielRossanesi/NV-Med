import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { createAdminClient } from '@/lib/supabase/admin';
import { mapUserFromDb } from '@/services/supabaseService';
import { SAAS_ROLES, TENANT_ROLES, sanitizeAdditionalPermissions } from '@/lib/permissions';

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function authorize(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const localOrigin = process.env.NODE_ENV === 'development' && host && /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)
    ? `${request.nextUrl.protocol}//${host}`
    : null;
  if (!origin || (origin !== request.nextUrl.origin && origin !== localOrigin)) return failure('Origem inválida.', 403);
  const client = await createClient();
  if (!client) return failure('Conexão indisponível.', 503);
  return await getAuthorizedUser(client) || failure('Entre novamente para gerenciar acessos.', 401);
}

function databaseFailure(error: { code: string; message: string }) {
  if (error.code === '42501') return failure(error.message, 403);
  if (error.code === 'PT409' || error.code === '23505') return failure(error.code === 'PT409' ? error.message : 'Este acesso já está cadastrado.', 409);
  if (error.code === '22023') return failure(error.message, 400);
  return failure('Não foi possível salvar o acesso. Confira os dados e tente novamente.', 502);
}

function managedUser(data: unknown, status = 200) {
  if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string') {
    return failure('O acesso foi salvo. Atualize a página para conferir o usuário.', 502);
  }
  return NextResponse.json({ user: mapUserFromDb(data as Parameters<typeof mapUserFromDb>[0]) }, { status });
}

export async function POST(request: NextRequest) { return save(request, false); }
export async function PATCH(request: NextRequest) { return save(request, true); }

export async function DELETE(request: NextRequest) {
  const actor = await authorize(request);
  if (actor instanceof NextResponse) return actor;
  const admin = createAdminClient();
  if (!admin) return failure('A administração de acessos não está configurada.', 503);
  try {
    const { data: profile } = await admin.from('user_accounts').select('id,type,role,status').eq('auth_user_id', actor.id).single();
    if (profile?.type !== 'saas_admin' || profile.status !== 'active' || !['CEO', 'Gerente'].includes(profile.role)) {
      return failure('Somente o administrador SaaS pode excluir contas. Use a desativação na sua empresa.', 403);
    }
    const input = await request.json();
    if (typeof input.id !== 'string' || input.id.length > 100) return failure('Confira o usuário.', 400);
    const { data: target } = await admin.from('user_accounts').select('*').eq('id', input.id).single();
    if (!target) return failure('Usuário não encontrado.', 404);
    if (target.id === profile.id || (target.type === 'saas_admin' && profile.role !== 'CEO')) return failure('Este perfil não pode ser excluído por você.', 403);
    if (typeof input.confirmation !== 'string' || input.confirmation.trim().toLowerCase() !== target.email.toLowerCase()) {
      return failure('Digite o e-mail exato do usuário para confirmar.', 400);
    }
    const { error: disableError } = await admin.rpc('nv_manage_user', {
      actor_auth: actor.id, target: target.id, new_auth: null, reason: 'Exclusão administrativa',
      changes: { ...target, revision: target.updated_at, status: 'inactive' },
    });
    if (disableError) return databaseFailure(disableError);
    if (target.auth_user_id) {
      const { error: authError } = await admin.auth.admin.deleteUser(target.auth_user_id);
      if (authError) return failure('O acesso foi desativado. Tente novamente para remover a credencial.', 502);
    }
    const { error: deleteError } = await admin.from('user_accounts').delete().eq('id', target.id).eq('status', 'inactive');
    if (deleteError) throw deleteError;
    if (target.avatar) await admin.storage.from('profile-avatars').remove([target.avatar]);
    return NextResponse.json({ deleted: true });
  } catch {
    return failure('Não foi possível concluir a exclusão do usuário.', 502);
  }
}

async function save(request: NextRequest, updating: boolean) {
  const actor = await authorize(request);
  if (actor instanceof NextResponse) return actor;
  const admin = createAdminClient();
  if (!admin) return failure('A criação de acessos ainda não foi configurada.', 503);
  try {
    const input = await request.json();
    const { name, email, type, organizationId, role, status } = input;
    if (typeof name !== 'string' || !name.trim() || name.length > 150
      || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || !['tenant_user', 'saas_admin'].includes(type) || !(type === 'saas_admin' ? SAAS_ROLES : TENANT_ROLES).includes(role)
      || !['active', 'pending', 'inactive'].includes(status)
      || (type === 'tenant_user' && (typeof organizationId !== 'string' || !organizationId || organizationId.length > 100))
      || (updating && (typeof input.id !== 'string' || input.id.length > 100 || typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))))) {
      return failure('Confira nome, e-mail, empresa, cargo e situação.', 400);
    }
    const changes = {
      name: name.trim(), email: email.trim().toLowerCase(), phone: typeof input.phone === 'string' ? input.phone.slice(0, 40) : '',
      type, organization_id: type === 'tenant_user' ? organizationId : null, role, status, revision: input.updatedAt,
      additional_permissions: sanitizeAdditionalPermissions(input.additionalPermissions, type),
      delegated_permissions: Array.isArray(input.delegatedPermissions) ? input.delegatedPermissions : [],
    };
    const args = { actor_auth: actor.id, target: updating ? input.id : null, new_auth: null as string | null,
      changes, reason: typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : null };
    if (updating) {
      const { data, error } = await admin.rpc('nv_manage_user', args).single();
      return error ? databaseFailure(error) : managedUser(data);
    }

    const preflight = await admin.rpc('nv_manage_user', args);
    if (preflight.error) return databaseFailure(preflight.error);
    const { data: auth, error: authError } = await admin.auth.admin.createUser({ email: changes.email, email_confirm: true });
    if (authError || !auth.user) return failure('Não foi possível criar o acesso. Verifique se o e-mail já está cadastrado.', 400);
    const { data, error } = await admin.rpc('nv_manage_user', { ...args, new_auth: auth.user.id }).single();
    if (error) {
      await admin.auth.admin.deleteUser(auth.user.id);
      return databaseFailure(error);
    }
    return managedUser(data, 201);
  } catch {
    return failure('Não foi possível salvar o acesso. Confira os dados e tente novamente.', 400);
  }
}
