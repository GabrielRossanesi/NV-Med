import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { authFlowUrl } from '@/lib/appOrigin';
import { portalError } from '@/lib/doctorPortal';

const response = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return response({ error: 'Origem inválida.' }, 403);
  const client = await createClient();
  if (!client) return response({ error: 'Conexão indisponível.' }, 503);
  if (!await getAuthorizedUser(client)) return response({ error: 'Sua sessão expirou. Entre novamente.' }, 401);
  const admin = createAdminClient();
  if (!admin) return response({ error: 'A gestão de acesso precisa ser configurada no servidor.' }, 503);
  const { id } = await context.params;
  let operationId: string | undefined;
  let message = '';
  let completed = false;
  try {
    const input = await request.json();
    if (!['invite', 'reset', 'email', 'block', 'unblock'].includes(input.action) || input.confirmed !== true
      || typeof input.revision !== 'string' || !Number.isFinite(Date.parse(input.revision))
      || (input.action === 'email' && (typeof input.email !== 'string' || input.email.length > 254))) {
      return response({ error: 'Confira a ação e confirme a operação.' }, 400);
    }
    // This uses the caller's session, never the service role, for authorization.
    const { data: operation, error } = await client.rpc('nv_begin_doctor_access', {
      target: id, operation: input.action, new_email: input.email ?? null, revision: input.revision,
    });
    if (error || !operation) return response({ error: error ? portalError(error) : 'Acesso indisponível.' }, error?.code === '42501' ? 403 : 409);
    operationId = operation.id;
    let authId: string | null = operation.auth_user_id;
    if (input.action === 'invite') {
      if (!authId) {
        // The migration's Auth INSERT trigger attaches the existing physician
        // in the account-creation transaction, before Supabase dispatches mail.
        const { data: created, error: createError } = await admin.auth.admin.inviteUserByEmail(operation.email, {
          redirectTo: authFlowUrl('/definir-senha', request.nextUrl.origin).href,
          data: { nv_med_access_operation: operationId },
        });
        if (createError || !created.user) throw new Error(createError?.code === 'email_address_not_authorized'
          ? 'O envio para este endereço não está autorizado. Confira a configuração SMTP do Supabase.'
          : createError?.status === 429 ? 'O limite de envio foi atingido. Aguarde antes de reenviar o convite.'
          : 'Não foi possível enviar o convite. Confira o e-mail e a configuração de envio do Supabase.');
        authId = created.user.id;
        message = 'Convite de ativação enviado. Os vínculos e o credenciamento foram preservados.';
      }
      // Persist the identity BEFORE sending a link. A delivery failure is retryable
      // without deleting the physician, their account or any existing relationships.
      const linked = await admin.rpc('nv_finish_doctor_access', { operation_id: operationId, outcome: 'linked', new_auth: authId });
      if (linked.error) throw new Error(portalError(linked.error));
    }
    if (input.action === 'reset' || (input.action === 'invite' && !message)) {
      const { error: sendError } = await admin.auth.resetPasswordForEmail(operation.email, {
        redirectTo: authFlowUrl('/definir-senha', request.nextUrl.origin).href,
      });
      if (sendError) throw new Error('Não foi possível enviar o e-mail. O vínculo foi preservado; aguarde e tente novamente.');
      message = input.action === 'invite' ? 'Link de ativação enviado. O credenciamento permanece sujeito à aprovação.' : 'Link de redefinição de senha enviado.';
    } else if (authId && input.action !== 'invite') {
      const { error: updateError } = await admin.auth.admin.updateUserById(authId,
        input.action === 'email' ? { email: operation.email, email_confirm: true }
          : { ban_duration: input.action === 'block' ? '876000h' : 'none' });
      if (updateError) throw new Error('Não foi possível alterar o acesso. Confira o e-mail e os vínculos da conta.');
      // The Auth trigger atomically synchronizes and audits all linked profiles.
      completed = true;
    }
    const finish = await admin.rpc('nv_finish_doctor_access', { operation_id: operationId, outcome: 'sent' });
    if (finish.error) throw new Error(completed
      ? 'O acesso foi alterado e auditado. Atualize a página para conferir o resultado.'
      : portalError(finish.error));
    return response({ message: message || (input.action === 'email' ? 'E-mail de acesso atualizado.' : input.action === 'block' ? 'Acesso bloqueado.' : 'Acesso desbloqueado.') });
  } catch (failure) {
    if (operationId) await admin.rpc('nv_finish_doctor_access', { operation_id: operationId, outcome: 'failed' });
    return response({ error: failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.' }, 502);
  }
}
