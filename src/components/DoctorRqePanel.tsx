'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { notify } from '@/lib/notifications';
import { directoryError } from './doctors/useDoctorDirectory';
import Dialog from './Dialog';

type Entry = { number: string; specialty: string | null };
type Snapshot = { entries: Entry[]; legacy: string | null; revision: string; canEdit: boolean };
export default function DoctorRqePanel({ doctorId, specialties, onChanged }: { doctorId: string; specialties: string[]; onChanged: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => { const response = await createClient()?.rpc('nv_doctor_rqes', { target: doctorId });
      if (active) { if (!response || response.error) setError(directoryError(response?.error?.code)); else setSnapshot(response.data); }
    })().catch(() => { if (active) setError('Não foi possível carregar os RQEs.'); });
    return () => { active = false; };
  }, [doctorId]);
  async function save() {
    if (!snapshot || !draft || busy) return;
    setBusy(true); setError(''); const finish = notify.saving();
    try {
      const response = await createClient()?.rpc('nv_doctor_rqes', { target: doctorId, entries: draft, revision: snapshot.revision });
      if (!response || response.error) { setError(response?.error?.code === '40001' ? 'Os RQEs foram alterados por outra pessoa. Feche e reabra o perfil antes de salvar.' : directoryError(response?.error?.code)); return; }
      setSnapshot(response.data); setDraft(null); onChanged(); notify.success('RQEs atualizados.');
    } catch { setError('Não foi possível salvar os RQEs. Tente novamente.'); }
    finally { finish(); setBusy(false); }
  }
  return <section id="doctor-rqes" className="nv-panel scroll-mt-24 space-y-3 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="nv-section-title">RQEs cadastrados</h3>{snapshot?.canEdit && <button className="nv-button-secondary" onClick={() => { setError(''); setDraft(snapshot.entries.map(entry => ({ ...entry }))); }}>Gerenciar RQEs</button>}</div>
    {!snapshot && !error && <p role="status" className="text-sm text-text-muted">Carregando RQEs…</p>}
    {!draft && error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {snapshot && <ul className="space-y-2 text-sm">
      {snapshot.legacy && !snapshot.entries.some(entry => entry.number === snapshot.legacy) && <li><span className="font-mono">{snapshot.legacy}</span> <span className="text-text-muted">Legado, sem vínculo identificado</span></li>}
      {snapshot.entries.map(entry => <li key={entry.number}><span className="font-mono">{entry.number}</span> <span className="text-text-muted">{entry.specialty || 'Sem vínculo identificado'}</span></li>)}
      {!snapshot.legacy && snapshot.entries.length === 0 && <li className="text-text-muted">RQE não informado</li>}
    </ul>}
    <p className="text-xs text-text-muted">A existência do registro não representa validação oficial. A ausência de RQE não altera o status cadastral.</p>
    {draft && <Dialog title="Gerenciar RQEs" onClose={() => setDraft(null)} closeDisabled={busy} footer={<div className="space-y-3">{error && <p role="alert" className="text-sm text-danger">{error}</p>}<div className="flex justify-end gap-2"><button className="nv-button-secondary" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button className="nv-button" disabled={busy} onClick={() => void save()}>{busy ? 'Salvando…' : 'Salvar RQEs'}</button></div></div>}>
      <div className="space-y-4"><p className="text-sm text-text-muted">Informe a especialidade somente quando o vínculo for conhecido. O RQE legado é preservado no cadastro.</p>
        {draft.map((entry, index) => <div key={index} className="grid gap-3 border-b border-border pb-4 sm:grid-cols-2">
          <label className="nv-label">RQE {index + 1}<input className="nv-input" inputMode="numeric" maxLength={20} value={entry.number} disabled={busy} onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, number: event.target.value } : item))}/></label>
          <label className="nv-label">Especialidade do RQE {index + 1}<select aria-label={`Especialidade do RQE ${index + 1}`} className="nv-input" disabled={busy} value={entry.specialty || ''} onChange={event => setDraft(draft.map((item, i) => i === index ? { ...item, specialty: event.target.value || null } : item))}>
            <option value="">Sem vínculo identificado</option>{Array.from(new Set([...specialties, entry.specialty].filter(Boolean))).map(specialty => <option key={specialty} value={specialty!}>{specialty}</option>)}
          </select></label><button className="min-h-9 justify-self-start text-xs font-medium text-danger hover:underline" disabled={busy} onClick={() => setDraft(draft.filter((_, i) => i !== index))}>Remover RQE {index + 1}</button>
        </div>)}
        <button className="nv-button-secondary" disabled={busy || draft.length >= 20} onClick={() => setDraft([...draft, { number: '', specialty: null }])}>Adicionar RQE</button>
      </div>
    </Dialog>}
  </section>;
}
