'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Camera, Check, Mail, Phone, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useStore } from '@/store/useStore';
import UserAvatar from '@/components/UserAvatar';

export default function ProfilePage() {
  const { currentUser, organizations, saving, updateProfile } = useStore();
  const [name, setName] = useState(currentUser.name);
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [localError, setLocalError] = useState('');

  const preview = useMemo(() => avatarFile ? URL.createObjectURL(avatarFile) : '', [avatarFile]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const organization = organizations.find((item) => item.id === currentUser.organizationId);
  const shownAvatar = removeAvatar ? undefined : (preview || currentUser.avatar);

  const chooseAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setLocalError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setLocalError('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
      event.target.value = '';
      return;
    }
    setAvatarFile(file);
    setRemoveAvatar(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    if (!name.trim()) {
      setLocalError('Informe seu nome.');
      return;
    }
    const form = new FormData();
    form.set('name', name.trim());
    form.set('phone', phone.trim());
    if (avatarFile) form.set('avatar', avatarFile);
    if (removeAvatar) form.set('removeAvatar', 'true');
    const success = await updateProfile(form);
    if (success) {
      setAvatarFile(null);
      setRemoveAvatar(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Conta</p>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">Meu perfil</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">Mantenha seus dados atualizados para que a equipe reconheça quem está gerenciando as escalas.</p>
      </header>

      <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <section className="rounded-2xl border border-border bg-card-bg p-6">
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <UserAvatar name={name || currentUser.name} src={shownAvatar} className="h-28 w-28 text-2xl" />
              <label className="absolute bottom-0 right-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-4 border-card-bg bg-primary text-text-inverse shadow-medium transition hover:bg-primary-hover" title="Escolher foto">
                <Camera className="h-4 w-4" />
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseAvatar} className="sr-only" />
              </label>
            </div>
            <h2 className="mt-4 text-base font-semibold text-text-primary">{name || 'Seu nome'}</h2>
            <p className="mt-1 text-xs text-text-muted">{currentUser.role}</p>
            <p className="mt-4 text-xs leading-relaxed text-text-muted">JPG, PNG ou WebP<br />até 5 MB</p>
            {(currentUser.avatar || avatarFile) && !removeAvatar && (
              <button type="button" onClick={() => { setAvatarFile(null); setRemoveAvatar(true); }} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-danger hover:underline">
                <Trash2 className="h-3.5 w-3.5" /> Remover foto
              </button>
            )}
          </div>
        </section>

        <section className="space-y-6 rounded-2xl border border-border bg-card-bg p-6 md:p-8">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Dados pessoais</h2>
            <p className="mt-1 text-xs text-text-muted">Nome e telefone aparecem apenas dentro do ambiente da empresa.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="nv-label sm:col-span-2">
              <span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-text-muted" /> Nome completo</span>
              <input className="nv-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={150} autoComplete="name" />
            </label>
            <label className="nv-label">
              <span className="flex items-center gap-2"><Phone className="h-4 w-4 text-text-muted" /> Telefone</span>
              <input className="nv-input" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" />
            </label>
            <label className="nv-label">
              <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-text-muted" /> E-mail de acesso</span>
              <input className="nv-input opacity-70" value={currentUser.email} disabled />
            </label>
          </div>

          <div className="grid gap-3 rounded-xl border border-border bg-surface-muted/45 p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Empresa</p>
              <p className="mt-1 font-medium text-text-primary">{organization?.name || (currentUser.type === 'saas_admin' ? 'NV Med SaaS' : 'Não vinculada')}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Nível de acesso</p>
              <p className="mt-1 flex items-center gap-1.5 font-medium text-text-primary"><ShieldCheck className="h-4 w-4 text-primary" /> {currentUser.role}</p>
            </div>
          </div>

          {localError && <p role="alert" className="text-sm font-medium text-danger">{localError}</p>}

          <div className="flex justify-end border-t border-border pt-5">
            <button type="submit" disabled={saving} className="nv-button min-w-40">
              <Check className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar perfil'}
            </button>
          </div>
        </section>
      </form>
    </div>
  );
}
