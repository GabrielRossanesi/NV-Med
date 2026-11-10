'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Dialog from './Dialog';

type Notification = { id: string; message: string; read_at?: string };
type Preferences = { offers: boolean; reminders: boolean; documents: boolean };
const labels: Record<keyof Preferences, string> = {
  offers: 'Vagas e trocas compatíveis',
  reminders: 'Lembretes de plantão',
  documents: 'Análise e vencimento de documentos',
};

export default function NotificationInbox({ preferences = false, revision = 0, variant = 'disclosure', documentAlerts = 0 }: {
  preferences?: boolean; revision?: number; variant?: 'disclosure' | 'header'; documentAlerts?: number;
}) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [settings, setSettings] = useState<Preferences | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState('');
  useEffect(() => {
    let active = true;
    const client = createClient();
    if (client) {
      void client.rpc('nv_portal_notifications').then(result => {
        if (!active) return;
        if (result.error) setError('Não foi possível consultar as notificações.');
        else setItems(result.data);
      });
      if (preferences) void client.rpc('nv_notification_preferences').then(result => {
        if (active && !result.error) setSettings(result.data);
      });
    }
    return () => { active = false; };
  }, [preferences, revision]);
  async function markRead(id: string) {
    setError('');
    setMarking(id);
    try {
      const result = await createClient()?.rpc('nv_portal_notifications', { mark_read: id });
      if (!result || result.error) throw new Error();
      setItems(result.data);
    } catch {
      setError('Não foi possível marcar a notificação como lida.');
    } finally {
      setMarking('');
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const result = await createClient()?.rpc('nv_save_notification_preferences', {
        offers: fields.has('offers'), reminders: fields.has('reminders'), documents: fields.has('documents'),
      });
      if (!result || result.error) throw new Error();
      setNotice('Preferências salvas.');
    } catch {
      setError('Não foi possível salvar as preferências.');
    } finally {
      setSaving(false);
    }
  }
  const unread = items?.filter(item => !item.read_at).length || 0;
  const content = <div className="space-y-3">
      {error && <p role="alert" className="nv-feedback text-danger">{error}</p>}
      {!items && !error && <p role="status" className="text-sm text-text-muted">Carregando notificações…</p>}
      {items?.length === 0 && <p className="nv-empty">Você ainda não tem notificações.</p>}
      <ul className="divide-y divide-border">{items?.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span className="break-words">{item.message}</span>{!item.read_at && <button type="button" disabled={Boolean(marking)} className="min-h-10 font-semibold text-primary underline disabled:opacity-60" onClick={() => void markRead(item.id)}>{marking === item.id ? 'Salvando…' : 'Marcar como lida'}</button>}
      </li>)}</ul>
      {preferences && settings && <form className="space-y-2 border-t border-border pt-3" onSubmit={save}>
        <h3 className="text-sm font-semibold">Preferências de avisos</h3>
        {Object.entries(labels).map(([key, label]) => <label className="flex items-center gap-2 text-sm" key={key}>
          <input type="checkbox" name={key} defaultChecked={settings[key as keyof Preferences]}/>{label}
        </label>)}
        <button className="nv-button-secondary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar preferências'}</button>
        {notice && <p role="status" className="nv-feedback text-success">{notice}</p>}
      </form>}
    </div>;
  if (variant === 'header') {
    const count = unread || documentAlerts;
    const label = unread ? `${unread} ${unread === 1 ? 'notificação não lida' : 'notificações não lidas'}` : documentAlerts ? `${documentAlerts} ${documentAlerts === 1 ? 'médico com pendências documentais' : 'médicos com pendências documentais'}` : 'Notificações';
    return <>
      <button type="button" aria-label={label} title={label} aria-haspopup="dialog" onClick={() => setOpen(true)} className="relative grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-text-secondary transition-colors hover:bg-state-hover hover:text-primary">
        <Bell size={18} aria-hidden="true" />
        {count > 0 && <span aria-hidden="true" className="absolute -top-0.5 right-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-[var(--alert-inverse)] ring-2 ring-surface">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && <Dialog title="Central de notificações" onClose={() => setOpen(false)}>
        {documentAlerts > 0 && <Link href="/documentos?status=pending" onClick={() => setOpen(false)} className="mb-4 block rounded-xl border border-warning/25 bg-warning/10 p-3 text-sm font-semibold text-warning hover:underline">
          {documentAlerts} {documentAlerts === 1 ? 'médico com documentação pendente' : 'médicos com documentação pendente'} na empresa ativa
        </Link>}
        <h3 className="mb-2 text-sm font-semibold text-text-secondary">Avisos pessoais{unread > 0 && ` · ${unread} não lidas`}</h3>
        {content}
      </Dialog>}
    </>;
  }
  if (!preferences && !items?.length) return null;
  return <details className="nv-panel nv-disclosure">
    <summary><Bell size={18} className="shrink-0 text-primary" aria-hidden="true"/><span className="flex flex-wrap items-center gap-x-2">Notificações{unread > 0 && <span className="nv-badge bg-primary/10 text-primary">{unread} não lidas</span>}</span><ChevronDown size={16} className="shrink-0 text-text-muted" aria-hidden="true"/></summary>
    <div className="p-4 sm:p-5">{content}</div>
  </details>;
}
