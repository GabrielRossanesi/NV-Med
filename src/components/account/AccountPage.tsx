'use client';

import { Camera, Shield, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import UserAvatar from '@/components/UserAvatar';
import ProfileMfa, { useAccountMfa } from '@/components/ProfileMfa';
import { useLocationHash } from '@/components/useLocationHash';
import { useStore } from '@/store/useStore';
import { formatAccountPhone, isAccountPhone } from '@/lib/account';
import { canViewPermission } from '@/lib/permissions';
import { notify } from '@/lib/notifications';
import { AccountSection, AccountValue } from './AccountSection';
import { AccountLeaveDialog, useAccountLeaveGuard } from './AccountLeaveGuard';
import AccountPreferencesPanel from './AccountPreferences';
import AccountActivity from './AccountActivity';
import styles from './Account.module.css';

const tabs = [
  { id: 'perfil', label: 'Perfil' },
  { id: 'seguranca', label: 'Segurança' },
  { id: 'preferencias', label: 'Preferências' },
  { id: 'atividade', label: 'Atividade' },
] as const;
type Tab = (typeof tabs)[number]['id'];

export default function AccountPage() {
  const { currentUser, organizations, activeOrganizationId, saving, updateProfile, error } = useStore();
  const [name, setName] = useState(currentUser.name);
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [avatar, setAvatar] = useState<{ file: File; url: string } | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [editedPhone, setEditedPhone] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { status, ...mfa } = useAccountMfa();
  const hash = useLocationHash();
  const tab = tabs.find(item => '#' + item.id === hash)?.id
    ?? (hash === '#verificacao-em-duas-etapas' ? 'seguranca' : 'perfil');
  const dirty = name.trim() !== currentUser.name.trim() || phone !== (currentUser.phone || '') || Boolean(avatar || removeAvatar);
  const validName = Boolean(name.trim()) && name.trim().length <= 150;
  const validPhone = !editedPhone || phone === (currentUser.phone || '') || isAccountPhone(phone);
  const guard = useAccountLeaveGuard(dirty || saving);

  useEffect(() => () => { if (avatar) URL.revokeObjectURL(avatar.url); }, [avatar]);

  const origin = organizations.find(item => item.id === currentUser.organizationId)?.name
    || (currentUser.type === 'saas_admin' ? 'NV Med' : 'Sem vínculo');
  const activeCompany = organizations.find(item => item.id === activeOrganizationId)?.name;
  const shownAvatar = removeAvatar ? undefined : (avatar?.url || currentUser.avatar);
  function setTab(next: Tab) {
    window.history.replaceState(window.history.state, '', '#' + next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  function tabsByKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(item => item.id === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next].id);
    document.getElementById('account-tab-' + tabs[next].id)?.focus();
  }

  function pickPhoto() {
    setTab('perfil');
    fileInput.current?.click();
  }

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
      notify.warning('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
      return;
    }
    setAvatar({ file, url: URL.createObjectURL(file) });
    setRemoveAvatar(false);
  }

  function reset() {
    setName(currentUser.name);
    setPhone(currentUser.phone || '');
    setEditedPhone(false);
    setAvatar(null);
    setRemoveAvatar(false);
    setFailed(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || !validName || !validPhone || saving) return;
    setFailed(false);
    const form = new FormData();
    form.set('name', name.trim());
    form.set('phone', phone);
    if (currentUser.updatedAt) form.set('revision', currentUser.updatedAt);
    if (avatar) form.set('avatar', avatar.file);
    if (removeAvatar) form.set('removeAvatar', 'true');
    if (await updateProfile(form)) {
      const saved = useStore.getState().currentUser;
      setName(saved.name);
      setPhone(saved.phone || '');
      setEditedPhone(false);
      setAvatar(null);
      setRemoveAvatar(false);
    } else setFailed(true);
  }

  return <div className="mx-auto min-w-0 max-w-6xl">
    <h1 className="mb-5 text-2xl font-semibold tracking-tight sm:text-3xl">Minha conta</h1>
    <header className={styles.identity}>
      <UserAvatar name={currentUser.name} src={shownAvatar} className="size-16 shrink-0 text-xl sm:size-20 sm:text-2xl" />
      <div className="min-w-0">
        <p className="break-words text-lg font-semibold leading-tight sm:text-xl">{currentUser.name}</p>
        <p className="mt-1 text-sm text-text-secondary">{currentUser.role}</p>
        <p className="mt-0.5 break-words text-sm text-text-muted"><span className="sr-only">Organização de origem </span>{origin}</p>
      </div>
      <div className={styles.identityStatus}>
        <span role="status" className={'inline-flex items-center gap-2 text-sm font-medium ' + (status?.configured ? 'text-success' : 'text-text-secondary')}>
          {status?.configured ? <ShieldCheck size={17} aria-hidden="true" /> : <Shield size={17} aria-hidden="true" />}
          {status ? (status.configured ? 'MFA configurado' : 'MFA não configurado')
            : mfa.error ? 'MFA indisponível' : 'Consultando MFA…'}
        </span>
        <button type="button" className="nv-button-secondary min-h-11" disabled={saving} onClick={pickPhoto}>
          <Camera size={16} aria-hidden="true" /> Editar foto
        </button>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseAvatar} ref={fileInput} hidden />
      </div>
    </header>

    <div role="tablist" aria-label="Minha conta" onKeyDown={tabsByKeyboard} className="mt-3 grid grid-cols-4 border-b border-border sm:flex">
      {tabs.map(item => <button key={item.id} type="button" id={'account-tab-' + item.id} role="tab" aria-selected={tab === item.id}
        aria-controls={'account-panel-' + item.id} tabIndex={tab === item.id ? 0 : -1}
        className={styles.tab + ' sm:px-6'} onClick={event => {
          setTab(item.id);
          event.currentTarget.focus({ preventScroll: true });
        }}>{item.label}</button>)}
    </div>

    <div role="tabpanel" id="account-panel-perfil" aria-labelledby="account-tab-perfil" hidden={tab !== 'perfil'}>
      <form onSubmit={submit} aria-busy={saving}>
        <AccountSection id="dados-pessoais" title="Informações pessoais">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="nv-label sm:col-span-2">Nome completo
              <input className="nv-input" value={name} onChange={event => setName(event.target.value)} maxLength={150}
                autoComplete="name" required disabled={saving} />
            </label>
            <label className="nv-label">Telefone
              <input className="nv-input" value={phone} onChange={event => {
                setEditedPhone(true);
                setPhone(formatAccountPhone(event.target.value));
              }} inputMode="tel" autoComplete="tel" maxLength={24} placeholder="(11) 99999-9999"
              aria-invalid={!validPhone} aria-describedby={!validPhone ? 'account-phone-error' : undefined} disabled={saving} />
              {!validPhone && <span id="account-phone-error" className="text-sm text-danger">Informe o DDD e o número.</span>}
            </label>
            <label className="nv-label">E-mail de acesso
              <input className="nv-input" value={currentUser.email} type="email" autoComplete="email" readOnly />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="text-sm">
              <p className="font-medium">Foto de perfil</p>
              <p className="mt-0.5 text-text-muted">JPG, PNG ou WebP de até 5 MB</p>
            </div>
            {shownAvatar && <button type="button" className="nv-button-secondary min-h-11 text-danger" disabled={saving}
              onClick={() => { setAvatar(null); setRemoveAvatar(Boolean(currentUser.avatar)); }}>Remover foto</button>}
          </div>
          {failed && error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {dirty && <button type="button" className="nv-button-secondary" onClick={reset} disabled={saving}>Cancelar</button>}
            <button type="submit" className="nv-button" disabled={!dirty || !validName || !validPhone || saving}>
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        </AccountSection>
      </form>
      <AccountSection id="vinculo" title="Vínculo profissional">
        <dl className="grid gap-4 sm:grid-cols-2">
          <AccountValue label="Organização de origem">{origin}</AccountValue>
          {activeCompany && <AccountValue label="Empresa selecionada"><span className="text-primary">{activeCompany}</span></AccountValue>}
          <AccountValue label="Cargo">{currentUser.role}</AccountValue>
          <AccountValue label="Nível de acesso">{currentUser.type === 'saas_admin' ? 'Administração NV Med' : 'Acesso à empresa'}</AccountValue>
        </dl>
        {currentUser.type === 'tenant_user' && canViewPermission(currentUser, 'usuarios')
          && <Link href="/admin/usuarios" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">Usuários da empresa</Link>}
      </AccountSection>
    </div>

    <div role="tabpanel" id="account-panel-seguranca" aria-labelledby="account-tab-seguranca" hidden={tab !== 'seguranca'}>
      {tab === 'seguranca' && <ProfileMfa status={status} {...mfa} />}
    </div>
    <div role="tabpanel" id="account-panel-preferencias" aria-labelledby="account-tab-preferencias" hidden={tab !== 'preferencias'}>
      {tab === 'preferencias' && <AccountPreferencesPanel user={currentUser} />}
    </div>
    <div role="tabpanel" id="account-panel-atividade" aria-labelledby="account-tab-atividade" tabIndex={tab === 'atividade' ? 0 : -1} hidden={tab !== 'atividade'}>
      {tab === 'atividade' && <AccountActivity />}
    </div>
    {guard.leave && <AccountLeaveDialog saving={saving} onCancel={() => guard.setLeave(null)} onConfirm={guard.confirmLeave} />}
  </div>;
}
