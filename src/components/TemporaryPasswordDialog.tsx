'use client';

import { useState } from 'react';
import { Check, CheckCircle2, Copy, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { UserAccount } from '@/types';
import { getPasswordChecks, isStrongPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/passwordPolicy';
import Dialog from './Dialog';

type Props = {
  user: UserAccount;
  busy: boolean;
  onClose: () => void;
  onSave: (password: string) => Promise<boolean>;
};

const passwordCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-=?';

function randomCharacter(characters: string) {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return characters[random[0] % characters.length];
}

function generatePassword() {
  const required = [
    randomCharacter('ABCDEFGHJKLMNPQRSTUVWXYZ'),
    randomCharacter('abcdefghijkmnopqrstuvwxyz'),
    randomCharacter('23456789'),
    randomCharacter('!@#$%&*+-=?'),
  ];
  while (required.length < 18) required.push(randomCharacter(passwordCharacters));
  for (let index = required.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swapIndex = random[0] % (index + 1);
    [required[index], required[swapIndex]] = [required[swapIndex], required[index]];
  }
  return required.join('');
}

const checkLabels: Record<keyof ReturnType<typeof getPasswordChecks>, string> = {
  length: `${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres`,
  lowercase: 'Uma letra minúscula',
  uppercase: 'Uma letra maiúscula',
  number: 'Um número',
  symbol: 'Um símbolo',
  noWhitespace: 'Sem espaços',
};

export default function TemporaryPasswordDialog({ user, busy, onClose, onSave }: Props) {
  const [password, setPassword] = useState(() => generatePassword());
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(true);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const checks = getPasswordChecks(password);
  const matches = password === confirmation;

  function regenerate() {
    setPassword(generatePassword());
    setConfirmation('');
    setCopied(false);
    setSaved(false);
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!isStrongPassword(password) || !matches) return;
    if (await onSave(password)) setSaved(true);
  }

  return (
    <Dialog title={saved ? 'Senha temporária criada' : 'Definir senha temporária'} onClose={() => !busy && onClose()}>
      {saved ? (
        <div className="space-y-5">
          <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-text-primary">A senha de {user.name} foi atualizada.</p>
              <p className="mt-1 text-sm text-text-muted">Copie-a agora. Por segurança, o NV Med não armazena nem permite consultar esta senha depois.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted p-3">
            <code className="min-w-0 flex-1 break-all text-sm font-semibold text-text-primary">{password}</code>
            <button type="button" onClick={copyPassword} className="nv-button-secondary shrink-0" aria-label="Copiar senha temporária">
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiada' : 'Copiar'}
            </button>
          </div>
          <div className="flex items-start gap-2 text-sm text-text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>No primeiro acesso, {user.name} será direcionado para criar uma senha pessoal.</span>
          </div>
          <div className="flex justify-end">
            <button type="button" className="nv-button" onClick={onClose}>Concluir</button>
          </div>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={submit}>
          <div>
            <p className="font-semibold text-text-primary">{user.name}</p>
            <p className="text-sm text-text-muted">{user.email}</p>
          </div>

          {user.status !== 'active' && (
            <p role="note" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
              Este usuário está {user.status === 'pending' ? 'com acesso pendente' : 'inativo'} e precisará ser ativado para entrar.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="temporary-password" className="nv-label">Senha temporária</label>
              <button type="button" onClick={regenerate} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-hover">
                <RefreshCw size={13} /> Gerar outra
              </button>
            </div>
            <div className="relative">
              <input
                id="temporary-password"
                className="nv-input pr-11 font-mono"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                required
                value={password}
                onChange={(event) => { setPassword(event.target.value); setSaved(false); }}
              />
              <button type="button" onClick={() => setVisible(value => !value)} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-text-muted hover:bg-state-hover hover:text-text-primary" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}>
                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <label className="nv-label">Confirmar senha
            <input
              className="nv-input mt-2 font-mono"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2" aria-label="Requisitos da senha">
            {Object.entries(checks).map(([key, valid]) => (
              <span key={key} className={`flex items-center gap-2 text-xs ${valid ? 'text-primary' : 'text-text-muted'}`}>
                <Check size={13} /> {checkLabels[key as keyof typeof checks]}
              </span>
            ))}
            <span className={`flex items-center gap-2 text-xs ${confirmation && matches ? 'text-primary' : 'text-text-muted'}`}>
              <Check size={13} /> Confirmação idêntica
            </span>
          </div>

          <div className="flex gap-3 rounded-xl border border-border bg-surface-muted/50 p-3 text-sm text-text-muted">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>A senha será válida para o primeiro acesso e deverá ser substituída pelo próprio usuário.</span>
          </div>

          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <button type="button" className="nv-button-secondary" disabled={busy} onClick={onClose}>Cancelar</button>
            <button className="nv-button" disabled={busy || !isStrongPassword(password) || !matches}>
              {busy ? 'Atualizando…' : 'Definir senha'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
