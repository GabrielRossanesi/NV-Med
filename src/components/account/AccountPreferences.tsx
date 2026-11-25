'use client';

import { useState, type FormEvent } from 'react';
import { accountHomeOptions, canReceiveAccountApplications, type AccountPreferences } from '@/lib/account';
import { canViewPermission } from '@/lib/permissions';
import { useStore } from '@/store/useStore';
import type { UserAccount } from '@/types';
import { AccountLoading, AccountSection } from './AccountSection';

export default function AccountPreferencesPanel({ user }: { user: UserAccount }) {
  const preferences = useStore(state => state.accountPreferences);
  const status = useStore(state => state.accountPreferencesStatus);
  const fetchPreferences = useStore(state => state.loadAccountPreferences);
  const savePreferences = useStore(state => state.saveAccountPreferences);
  const [draft, setDraft] = useState<Partial<AccountPreferences>>({});
  const [saving, setSaving] = useState(false);
  const options = accountHomeOptions(user);
  const canSeeSchedule = canViewPermission(user, 'escala');
  const canSeeDocuments = canViewPermission(user, 'documentos');
  const current = { ...preferences, ...draft };
  const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) =>
    value !== preferences[key as keyof AccountPreferences])) as Partial<AccountPreferences>;
  const dirty = Object.keys(changed).length > 0;

  function update<K extends keyof AccountPreferences>(key: K, value: AccountPreferences[K]) {
    setDraft(previous => ({ ...previous, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try { if (await savePreferences(changed)) setDraft({}); }
    finally { setSaving(false); }
  }

  if (status !== 'ready') return <AccountSection id="aparencia" title="Aparência">
    {status === 'loading' ? <AccountLoading label="Carregando preferências" /> : <>
      <p role="alert" className="text-sm text-danger">Não foi possível carregar as preferências.</p>
      <button type="button" className="nv-button-secondary" onClick={() => void fetchPreferences()}>Tentar novamente</button>
    </>}
  </AccountSection>;

  return <form onSubmit={save} aria-busy={saving}>
    <AccountSection id="aparencia" title="Aparência">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="nv-label">Tema
          <select className="nv-input" value={current.theme} disabled={saving} onChange={event => update('theme', event.target.value as AccountPreferences['theme'])}>
            <option value="light">Claro</option><option value="dark">Escuro</option><option value="system">Do sistema</option>
          </select>
        </label>
        <label className="nv-label">Menu lateral
          <select className="nv-input" value={String(current.sidebarCollapsed)} disabled={saving} onChange={event => update('sidebarCollapsed', event.target.value === 'true')}>
            <option value="false">Expandido</option><option value="true">Recolhido</option>
          </select>
        </label>
        <label className="nv-label">Densidade visual
          <select className="nv-input" value={current.density} disabled={saving} onChange={event => update('density', event.target.value as AccountPreferences['density'])}>
            <option value="comfortable">Confortável</option><option value="compact">Compacta</option>
          </select>
        </label>
      </div>
    </AccountSection>

    {(options.length > 0 || canSeeSchedule) && <AccountSection id="experiencia" title="Experiência de uso">
      <div className="grid gap-4 sm:grid-cols-2">
        {canSeeSchedule && <label className="nv-label">Visualização inicial da escala
          <select className="nv-input" value={current.scheduleView} disabled={saving} onChange={event => update('scheduleView', event.target.value as AccountPreferences['scheduleView'])}>
            <option value="calendar">Calendário</option><option value="list">Lista</option>
          </select>
        </label>}
        {options.length > 0 && <label className="nv-label">Página inicial após o login
          <select className="nv-input" value={current.homePage} disabled={saving} onChange={event => update('homePage', event.target.value as AccountPreferences['homePage'])}>
            <option value="">Padrão do NV Med</option>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>}
      </div>
    </AccountSection>}

    <AccountSection id="avisos" title="Notificações">
      {canReceiveAccountApplications(user) && <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 shrink-0" checked={current.applicationAlerts} disabled={saving}
          onChange={event => update('applicationAlerts', event.target.checked)} />
        <span><span className="block font-medium">Candidaturas</span>
          <span className="mt-0.5 block text-text-muted">Receber novos avisos de candidaturas que aguardam decisão.</span></span>
      </label>}
      {canSeeDocuments && <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 shrink-0" checked={current.documentAlerts} disabled={saving}
          onChange={event => update('documentAlerts', event.target.checked)} />
        <span><span className="block font-medium">Pendências documentais</span>
          <span className="mt-0.5 block text-text-muted">Exibe o aviso da empresa ativa na central de notificações.</span></span>
      </label>}
      <p className="text-sm text-text-muted">Avisos obrigatórios de segurança permanecem ativos.</p>
    </AccountSection>

    <div className="mt-4 flex flex-wrap gap-2 sm:justify-end">
      {dirty && <button type="button" className="nv-button-secondary" disabled={saving} onClick={() => setDraft({})}>Cancelar</button>}
      <button className="nv-button" disabled={!dirty || saving}>{saving ? 'Salvando…' : 'Salvar preferências'}</button>
    </div>
  </form>;
}
