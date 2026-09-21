import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isStrongPassword } from '@/lib/passwordPolicy';

async function authorize(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) throw new Error('Origem inválida.');
  const client = await createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Entre novamente.');
  const { data: profile } = await client.from('user_accounts').select('id,type,role,status').eq('auth_user_id', user.id).single();
  if (profile?.type !== 'saas_admin' || profile.status !== 'active' || !['CEO', 'Gerente'].includes(profile.role)) throw new Error('Acesso restrito ao administrador.');
  return profile;
}

export async function PATCH(request: NextRequest) {
  let profile;
  try { profile = await authorize(request); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Acesso negado.' }, { status: 403 }); }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'A administração de acessos não está configurada no servidor.' }, { status: 503 });

  try {
    const input = await request.json();
    if (typeof input.id !== 'string' || typeof input.password !== 'string' || !isStrongPassword(input.password)) {
      return NextResponse.json({ error: 'Use de 12 a 72 caracteres, com maiúscula, minúscula, número e símbolo, sem espaços.' }, { status: 400 });
    }

    const { data: target } = await admin.from('user_accounts').select('id,auth_user_id,type').eq('id', input.id).single();
    if (!target) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    if (target.id === profile.id) return NextResponse.json({ error: 'Altere sua própria senha pelo perfil ou pela recuperação de acesso.' }, { status: 403 });
    if (target.type === 'saas_admin' && profile.role !== 'CEO') return NextResponse.json({ error: 'Somente o CEO pode definir a senha de outro administrador SaaS.' }, { status: 403 });
    if (!target.auth_user_id) return NextResponse.json({ error: 'Este perfil ainda não possui uma conta de autenticação vinculada.' }, { status: 409 });

    const { data: authRecord, error: readError } = await admin.auth.admin.getUserById(target.auth_user_id);
    if (readError || !authRecord.user) throw readError;
    const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
      password: input.password,
      app_metadata: {
        ...authRecord.user.app_metadata,
        must_change_password: true,
        temporary_password_set_at: new Date().toISOString(),
      },
    });
    if (updateError) throw updateError;
    return NextResponse.json({ updated: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar a senha. Tente novamente.' }, { status: 500 });
  }
}
