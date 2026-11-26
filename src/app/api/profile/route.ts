import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { mapUserFromDb } from '@/services/supabaseService';
import { readBoundedBody } from '@/lib/documentAccess';
import { decodeAvatar, maxAvatarRequestBytes } from '@/lib/avatarFile';
import { isAccountPhone } from '@/lib/account';

const avatarBucket = 'profile-avatars';
const sizeError = 'Escolha uma foto JPG, PNG ou WebP de até 5 MB.';

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }
  if (Number(request.headers.get('content-length')) > maxAvatarRequestBytes) {
    return NextResponse.json({ error: sizeError }, { status: 413 });
  }
  const contentType = request.headers.get('content-type');
  if (!contentType || !/^multipart\/form-data;/i.test(contentType)) {
    return NextResponse.json({ error: 'Envie um formulário de perfil.' }, { status: 415 });
  }

  const client = await createClient();
  const admin = createAdminClient();
  if (!client || !admin) return NextResponse.json({ error: 'Conexão indisponível.' }, { status: 503 });

  const { data: { user: authUser }, error: authError } = await client.auth.getUser();
  if (authError || !authUser) return NextResponse.json({ error: 'Sua sessão expirou. Entre novamente.' }, { status: 401 });
  const { data: sessionReady, error: sessionError } = await client.rpc('nv_account_session_ready');
  if (sessionError) return NextResponse.json({ error: 'Não foi possível consultar sua sessão.' }, { status: 503 });
  if (sessionReady !== true) return NextResponse.json({ error: 'Sua sessão expirou. Entre novamente.' }, { status: 401 });

  try {
    const body = await readBoundedBody(request, maxAvatarRequestBytes);
    if (body === null) return NextResponse.json({ error: sizeError }, { status: 413 });
    const form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData().catch(() => null);
    if (!form || form.getAll('avatar').length > 1) return NextResponse.json({ error: 'Confira o formulário do perfil.' }, { status: 400 });
    const nameInput = form.get('name');
    const phone = form.get('phone');
    const revision = form.get('revision');
    const name = typeof nameInput === 'string' ? nameInput.trim() : '';
    const removeAvatar = form.get('removeAvatar') === 'true';
    const file = form.get('avatar');

    if (!name || name.length > 150 || typeof phone !== 'string' || phone.length > 40 || (file && removeAvatar)) {
      return NextResponse.json({ error: 'Confira o nome e o telefone.' }, { status: 400 });
    }
    const { data: previous, error: profileError } = await admin
      .from('user_accounts')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .eq('status', 'active')
      .single();
    if (profileError || !previous) return NextResponse.json({ error: 'Perfil ativo não encontrado.' }, { status: 404 });
    const conflict = () => NextResponse.json({ error: 'O perfil mudou desde que você abriu a página. Recarregue para atualizar os dados.' }, { status: 409 });
    if (revision && revision !== previous.updated_at) return conflict();
    if (phone !== (previous.phone || '') && !isAccountPhone(phone)) {
      return NextResponse.json({ error: 'Informe o DDD e o número de telefone.' }, { status: 400 });
    }

    const avatar = file instanceof File ? await decodeAvatar(file) : null;
    if (file !== null && !avatar) return NextResponse.json({ error: sizeError }, { status: 415 });

    let nextAvatar = removeAvatar ? '' : (previous.avatar || '');
    let uploadedPath = '';
    if (avatar) {
      uploadedPath = `${authUser.id}/${crypto.randomUUID()}.${avatar.extension}`;
      const { error: uploadError } = await admin.storage.from(avatarBucket).upload(uploadedPath, avatar.body, {
        contentType: avatar.contentType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      nextAvatar = uploadedPath;
    }

    const query = admin
      .from('user_accounts')
      .update({ name, phone, avatar: nextAvatar })
      .eq('id', previous.id)
      .eq('auth_user_id', authUser.id)
      .eq('status', 'active');
    const { data: updated, error: updateError } = await (previous.updated_at
      ? query.eq('updated_at', previous.updated_at) : query.is('updated_at', null))
      .select('*')
      .maybeSingle();

    if (updateError || !updated) {
      if (uploadedPath) await admin.storage.from(avatarBucket).remove([uploadedPath]);
      if (updateError) throw updateError;
      return conflict();
    }

    if (typeof previous.avatar === 'string' && previous.avatar.startsWith(authUser.id + '/') && previous.avatar !== nextAvatar) {
      await admin.storage.from(avatarBucket).remove([previous.avatar]);
    }

    const profile = mapUserFromDb(updated);
    profile.email = authUser.email || profile.email;
    if (nextAvatar) {
      const { data: signed } = await admin.storage.from(avatarBucket).createSignedUrl(nextAvatar, 3600);
      profile.avatar = signed?.signedUrl || '';
    }

    return NextResponse.json({ user: profile });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar seu perfil. Tente novamente.' }, { status: 500 });
  }
}
