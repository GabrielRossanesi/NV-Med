import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { readBoundedBody } from '@/lib/documentAccess';
import { isStrongPassword } from '@/lib/passwordPolicy';

function reply(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return reply({ error: 'Origem inválida.' }, 403);
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return reply({ error: 'Envie uma solicitação válida.' }, 415);
  }

  const body = await readBoundedBody(request, 4096).catch(() => null);
  const input = body && await new Response(body).json().catch(() => null);
  const operation = input?.operation;
  if (!['password', 'passwordChallenge', 'remove', 'revoke', 'enroll'].includes(operation)) {
    return reply({ error: 'Operação inválida.' }, 400);
  }

  const client = await createClient();
  if (!client) return reply({ error: 'Conexão indisponível.' }, 503);
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return reply({ error: 'Sua sessão expirou. Entre novamente.' }, 401);

  const { data: ready, error: accessError } = await client.rpc('nv_account_security_ready', {
    requires_mfa: operation === 'remove',
  });
  if (accessError) return reply({ error: 'Não foi possível confirmar a segurança da sessão.' }, 503);
  if (ready !== true) return reply({ error: 'Confirme sua identidade novamente.', code: 'step_up' }, 403);

  if (operation === 'enroll') {
    const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', issuer: 'NV Med' });
    if (error) return reply({ error: 'Não foi possível iniciar o cadastro do autenticador.' }, 422);
    const prefix = 'data:image/svg+xml;utf-8,';
    const svg = data.totp.qr_code;
    if (!svg.startsWith(prefix)) {
      await client.auth.mfa.unenroll({ factorId: data.id });
      return reply({ error: 'Não foi possível preparar o QR Code.' }, 502);
    }
    return reply({ enrollment: { id: data.id, qr: prefix + encodeURIComponent(svg.slice(prefix.length)) } });
  }

  if (operation === 'remove') {
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) return reply({ error: 'Não foi possível consultar seus autenticadores.' }, 503);
    if (typeof input.factorId !== 'string' || !data.totp.some(factor => factor.id === input.factorId)) {
      return reply({ error: 'Autenticador indisponível.' }, 404);
    }
    if (data.totp.length < 2) return reply({ error: 'Cadastre outro autenticador antes de remover o último.' }, 409);
    const { error: removalError } = await client.auth.mfa.unenroll({ factorId: input.factorId });
    return removalError ? reply({ error: 'Não foi possível remover o autenticador. Atualize a lista e tente novamente.' }, 409)
      : reply({ updated: true });
  }

  if (operation === 'revoke') {
    const { error } = await client.auth.signOut({ scope: 'others' });
    return error ? reply({ error: 'Não foi possível encerrar as outras sessões.' }, 422) : reply({ updated: true });
  }

  if (operation === 'passwordChallenge') {
    const { error } = await client.auth.reauthenticate();
    return error ? reply({ error: 'Não foi possível enviar o código de confirmação.' }, 422) : reply({ sent: true });
  }

  if (typeof input.password !== 'string' || !isStrongPassword(input.password)
    || Buffer.byteLength(input.password, 'utf8') > 72 || input.password !== input.confirmation) {
    return reply({ error: 'Confira os requisitos e a confirmação da nova senha.' }, 400);
  }
  if ((input.nonce !== undefined && (typeof input.nonce !== 'string' || !/^\d{6,10}$/.test(input.nonce)))
    || (input.currentPassword !== undefined && (typeof input.currentPassword !== 'string' || input.currentPassword.length > 256))) {
    return reply({ error: 'Confira os dados de confirmação.' }, 400);
  }

  const { error } = await client.auth.updateUser({
    password: input.password,
    nonce: input.nonce,
    current_password: input.currentPassword,
  });
  if (!error) return reply({ updated: true });
  if (error.code === 'reauthentication_needed' || error.code === 'reauthentication_not_valid') {
    return reply({ error: 'Solicite e confirme o código de segurança.', code: 'nonce' }, 422);
  }
  if (error.code === 'current_password_required' || error.code === 'current_password_mismatch') {
    return reply({ error: 'Confira a senha atual.', code: 'current_password' }, 422);
  }
  if (error.code === 'same_password') return reply({ error: 'Escolha uma senha diferente da atual.' }, 422);
  return reply({ error: 'Não foi possível atualizar a senha. Tente novamente.' }, 422);
}
