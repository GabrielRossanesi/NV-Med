import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { mapUserFromDb } from '@/services/supabaseService';

const avatarBucket = 'profile-avatars';
const allowedAvatarTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }

  const client = await createClient();
  const admin = createAdminClient();
  if (!client || !admin) return NextResponse.json({ error: 'Conexão indisponível.' }, { status: 503 });

  const { data: { user: authUser } } = await client.auth.getUser();
  if (!authUser) return NextResponse.json({ error: 'Sua sessão expirou. Entre novamente.' }, { status: 401 });

  try {
    const form = await request.formData();
    const name = String(form.get('name') || '').trim();
    const phone = String(form.get('phone') || '').trim();
    const removeAvatar = form.get('removeAvatar') === 'true';
    const file = form.get('avatar');

    if (!name || name.length > 150 || phone.length > 40) {
      return NextResponse.json({ error: 'Confira o nome e o telefone.' }, { status: 400 });
    }

    const { data: previous, error: profileError } = await admin
      .from('user_accounts')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .eq('status', 'active')
      .single();
    if (profileError || !previous) return NextResponse.json({ error: 'Perfil ativo não encontrado.' }, { status: 404 });

    let nextAvatar = removeAvatar ? '' : (previous.avatar || '');
    let uploadedPath = '';
    if (file instanceof File && file.size > 0) {
      const extension = allowedAvatarTypes.get(file.type);
      if (!extension || file.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: 'Escolha uma foto JPG, PNG ou WebP de até 5 MB.' }, { status: 400 });
      }
      uploadedPath = `${authUser.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await admin.storage.from(avatarBucket).upload(uploadedPath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      nextAvatar = uploadedPath;
    }

    const { data: updated, error: updateError } = await admin
      .from('user_accounts')
      .update({ name, phone, avatar: nextAvatar })
      .eq('id', previous.id)
      .eq('auth_user_id', authUser.id)
      .select('*')
      .single();

    if (updateError || !updated) {
      if (uploadedPath) await admin.storage.from(avatarBucket).remove([uploadedPath]);
      throw updateError || new Error('Perfil não atualizado.');
    }

    if (previous.avatar && previous.avatar !== nextAvatar) {
      await admin.storage.from(avatarBucket).remove([previous.avatar]);
    }

    const profile = mapUserFromDb(updated);
    if (nextAvatar) {
      const { data: signed } = await admin.storage.from(avatarBucket).createSignedUrl(nextAvatar, 3600);
      profile.avatar = signed?.signedUrl || '';
    }

    return NextResponse.json({ user: profile });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar seu perfil. Tente novamente.' }, { status: 500 });
  }
}
