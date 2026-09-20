import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mapUserFromDb } from '@/services/supabaseService';
const tenantRoles = ['Diretor', 'Gerente', 'Coordenador de Escalas', 'Escalista', 'Financeiro', 'Jurídico'];
const adminRoles = ['CEO', 'Gerente', 'Coordenador', 'Administrativo', 'Financeiro', 'Jurídico'];
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
export async function POST(request: NextRequest) { return save(request, false); }
export async function PATCH(request: NextRequest) { return save(request, true); }
async function save(request: NextRequest, updating: boolean) {
  let profile;
  try { profile = await authorize(request); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Acesso negado.' }, { status: 403 }); }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: 'A criação de acessos ainda não foi configurada no servidor.' }, { status: 503 });
  try {
    const input = await request.json();
    const { name, email, type, organizationId, role, status } = input;
    if (typeof name !== 'string' || !name.trim() || name.length > 150 || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['tenant_user', 'saas_admin'].includes(type) || !(type === 'saas_admin' ? adminRoles : tenantRoles).includes(role) || !['active', 'pending', 'inactive'].includes(status)) return NextResponse.json({ error: 'Confira nome, e-mail, cargo e situação.' }, { status: 400 });
    if (type === 'saas_admin' && profile.role !== 'CEO') return NextResponse.json({ error: 'Somente o CEO pode gerenciar administradores SaaS.' }, { status: 403 });
    if (type === 'tenant_user') {
      const { data: org } = await admin.from('organizations').select('id').eq('id', organizationId).single();
      if (!org) return NextResponse.json({ error: 'Selecione uma empresa válida.' }, { status: 400 });
    }
    const payload = { name: name.trim(), email: email.trim().toLowerCase(), phone: typeof input.phone === 'string' ? input.phone.slice(0, 40) : '', type, organization_id: type === 'tenant_user' ? organizationId : null, role, status };
    if (updating) {
      const { data: previous } = await admin.from('user_accounts').select('*').eq('id', input.id).single();
      if (!previous || previous.id === profile.id || (previous.type === 'saas_admin' && profile.role !== 'CEO')) return NextResponse.json({ error: 'Este perfil não pode ser alterado por você.' }, { status: 403 });
      if (previous.email.toLowerCase() !== payload.email) return NextResponse.json({ error: 'A troca do e-mail de acesso deve ser feita pelo administrador no Supabase Auth.' }, { status: 400 });
      const { data, error } = await admin.from('user_accounts').update(payload).eq('id', previous.id).select().single();
      if (error) throw error;
      return NextResponse.json({ user: mapUserFromDb(data) });
    }
    const { data: auth, error: authError } = await admin.auth.admin.createUser({ email: payload.email, email_confirm: true });
    if (authError || !auth.user) return NextResponse.json({ error: 'Não foi possível criar o acesso. Verifique se o e-mail já está cadastrado.' }, { status: 400 });
    const { data, error } = await admin.from('user_accounts').insert({ ...payload, id: crypto.randomUUID(), auth_user_id: auth.user.id }).select().single();
    if (error) { await admin.auth.admin.deleteUser(auth.user.id); throw error; }
    // No invitation is sent automatically. The user requests their own first-access link.
    return NextResponse.json({ user: mapUserFromDb(data) }, { status: 201 });
  } catch { return NextResponse.json({ error: 'Não foi possível salvar o acesso. Confira os dados e tente novamente.' }, { status: 500 }); }
}
