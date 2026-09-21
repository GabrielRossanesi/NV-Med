import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isStrongPassword } from '@/lib/passwordPolicy';
import { completePasswordChangeMetadata } from '@/lib/passwordLifecycle';

export async function PATCH(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  const client = await createClient();
  if (!client) return NextResponse.json({ error: 'Conexão indisponível.' }, { status: 503 });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Abra novamente o link de acesso ou entre com a senha temporária.' }, { status: 401 });

  try {
    const input = await request.json();
    if (typeof input.password !== 'string' || !isStrongPassword(input.password)) {
      return NextResponse.json({ error: 'Use de 12 a 72 caracteres, com maiúscula, minúscula, número e símbolo, sem espaços.' }, { status: 400 });
    }
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: 'A atualização de senha não está configurada no servidor.' }, { status: 503 });
    const { data: authRecord, error: readError } = await admin.auth.admin.getUserById(user.id);
    if (readError || !authRecord.user) throw readError;
    // GoTrue merges app_metadata updates. Omitting a key does not reliably clear
    // the value already stored, so the first-login flag must be set explicitly.
    const appMetadata = completePasswordChangeMetadata(authRecord.user.app_metadata);
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: input.password, app_metadata: appMetadata });
    if (updateError) throw updateError;
    const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
    return NextResponse.json({
      updated: true,
      sessionRefreshed: !refreshError && refreshed.user?.app_metadata?.must_change_password !== true,
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar a nova senha. Tente novamente.' }, { status: 500 });
  }
}
