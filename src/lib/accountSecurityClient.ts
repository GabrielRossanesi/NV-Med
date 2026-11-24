export async function accountSecurityRequest(body: Record<string, unknown>) {
  const response = await fetch('/api/account/security', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new AccountSecurityError(result?.error || 'Não foi possível concluir a operação.', result?.code);
  return result;
}

export class AccountSecurityError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export const accountDateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
