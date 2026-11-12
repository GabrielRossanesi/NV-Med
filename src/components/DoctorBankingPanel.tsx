'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { bankingFromForm, pixKeyTypes, type DoctorBanking } from '@/lib/doctorBanking';
import { portalError } from '@/lib/doctorPortal';
import DoctorBankingFields from './DoctorBankingFields';

type Snapshot = { complete: boolean; can_edit: boolean; can_history: boolean; details: DoctorBanking };
type Audit = { id: number; actor_id: string | null; doctor_id: string; created_at: string; change_type: string; changed_fields: string[] };
const fieldLabels: Record<string, string> = { pix_key: 'Chave PIX', pix_key_type: 'Tipo de chave', bank: 'Banco', bank_code: 'COMPE', bank_ispb: 'ISPB', agency: 'Agência', account_number: 'Conta corrente' };

export default function DoctorBankingPanel({ doctor, title = 'Dados bancários' }: { doctor: string; title?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<Audit[] | null>(null);
  useEffect(() => {
    let live = true;
    void createClient()?.rpc('nv_doctor_banking', { target: doctor }).then(result => {
      if (!live) return;
      if (result.error) setError('Não foi possível consultar os dados bancários.');
      else setSnapshot(result.data);
    });
    return () => { live = false; };
  }, [doctor]);
  async function load(reveal: boolean, edit = false) {
    setBusy(true); setError('');
    // Clear full values immediately when the user hides or cancels editing.
    if (!reveal) { setSnapshot(null); setEditing(false); setRevealed(false); }
    try {
      const result = await createClient()?.rpc('nv_doctor_banking', { target: doctor, reveal });
      if (!result || result.error) throw new Error('Não foi possível consultar os dados bancários.');
      setSnapshot(result.data); setRevealed(reveal); setEditing(edit);
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const details = bankingFromForm(new FormData(event.currentTarget));
      setBusy(true);
      const result = await createClient()?.rpc('nv_update_doctor_banking', { target: doctor, details });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      setHistory(null);
      await load(false);
      setNotice('Dados bancários salvos com sucesso.');
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function showHistory() {
    setBusy(true); setError('');
    try {
      const result = await createClient()?.rpc('nv_doctor_banking_history', { target: doctor });
      if (!result || result.error) throw new Error('Não foi possível consultar o histórico.');
      setHistory(result.data);
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <section className="nv-panel min-w-0 space-y-4 p-4 sm:p-5" aria-label={title}>
    <div><h3 className="nv-section-title">{title}</h3><p className="mt-1 text-xs text-text-muted">Dados protegidos. Exiba os valores completos apenas quando necessário.</p></div>
    {snapshot && !snapshot.complete && <p role="status" className="rounded-lg bg-warning/10 p-3 text-sm text-warning">Pendência cadastral: confirme a chave PIX e informe seu tipo. Esta pendência não altera os plantões já assumidos.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {!snapshot && !error && <p role="status" className="text-sm text-text-muted">Carregando dados bancários…</p>}
    {snapshot && (editing ? <form onSubmit={save} className="space-y-4">
      <DoctorBankingFields initial={snapshot.details} disabled={busy}/>
      <div className="flex flex-wrap gap-2"><button className="nv-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button><button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void load(false)}>Cancelar</button></div>
    </form> : <>
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-text-muted">Tipo de chave PIX</dt><dd>{snapshot.details.pix_key_type ? pixKeyTypes[snapshot.details.pix_key_type] : 'Pendente'}</dd></div>
        {(['pix_key', 'bank', 'agency', 'account_number'] as const).map(field => <div key={field}><dt className="text-text-muted">{fieldLabels[field]}</dt><dd className="break-all">{snapshot.details[field] || 'Não informado'}</dd></div>)}
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void load(!revealed)}>{revealed ? 'Ocultar valores' : 'Exibir valores'}</button>
        {snapshot.can_edit && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void load(true, true)}>Editar dados bancários</button>}
        {snapshot.can_history && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => history ? setHistory(null) : void showHistory()}>{history ? 'Ocultar histórico' : 'Histórico de alterações'}</button>}
      </div>
    </>)}
    {history && <div className="space-y-3 border-t border-border pt-4"><h4 className="text-sm font-semibold">Últimas alterações</h4>{!history.length && <p className="text-xs text-text-muted">Nenhuma alteração registrada após a implantação.</p>}{history.map(item => <div key={item.id} className="space-y-1 text-xs">
      <p>{new Date(item.created_at).toLocaleString('pt-BR')} · {item.change_type === 'created' ? 'Cadastro' : 'Atualização'}</p>
      <p className="break-all text-text-muted">Responsável: {item.actor_id || 'Conta removida'} · Médico: {item.doctor_id}</p>
      <p>{item.changed_fields.map(field => fieldLabels[field] || field).join(', ')}</p>
    </div>)}</div>}
  </section>;
}
