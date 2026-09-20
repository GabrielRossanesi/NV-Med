import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

type CleanupResult = {
  auth_user_ids?: string[];
  avatar_paths?: string[];
  document_paths?: string[];
};

async function authorize(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) throw new Error('Origem inválida.');
  const client = await createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Entre novamente.');
  const { data: profile } = await client.from('user_accounts').select('type,role,status').eq('auth_user_id', user.id).single();
  if (profile?.type !== 'saas_admin' || profile.status !== 'active' || profile.role !== 'CEO') throw new Error('Somente o CEO pode excluir empresas.');
}

export async function DELETE(request: NextRequest) {
  try { await authorize(request); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Acesso negado.' }, { status: 403 }); }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'A administração de empresas não está configurada no servidor.' }, { status: 503 });

  try {
    const input = await request.json();
    const { data: organization } = await admin.from('organizations').select('id,name').eq('id', input.id).single();
    if (!organization) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    if (typeof input.confirmation !== 'string' || input.confirmation.trim() !== organization.name.trim()) {
      return NextResponse.json({ error: 'Digite o nome exato da empresa para confirmar.' }, { status: 400 });
    }

    const { data, error } = await admin.rpc('nv_delete_organization', { target_id: organization.id });
    if (error) throw error;
    const cleanup = (data || {}) as CleanupResult;

    if (cleanup.document_paths?.length) await admin.storage.from('medical-documents').remove(cleanup.document_paths);
    if (cleanup.avatar_paths?.length) await admin.storage.from('profile-avatars').remove(cleanup.avatar_paths);
    for (const authUserId of cleanup.auth_user_ids || []) await admin.auth.admin.deleteUser(authUserId);

    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível excluir a empresa. Verifique os vínculos e tente novamente.' }, { status: 500 });
  }
}
