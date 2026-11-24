'use client';

import { useState, type FormEvent } from 'react';
import Dialog from '@/components/Dialog';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { notify } from '@/lib/notifications';
import { useStore } from '@/store/useStore';
import type { Unit } from '@/types';

const zones: Record<string,string> = {
  'America/Sao_Paulo': 'Brasília e Sudeste',
  'America/Bahia': 'Bahia',
  'America/Belem': 'Pará e Amapá',
  'America/Fortaleza': 'Ceará, Maranhão, Piauí e outros estados',
  'America/Recife': 'Pernambuco continental e Paraíba',
  'America/Maceio': 'Alagoas e Sergipe',
  'America/Araguaina': 'Tocantins',
  'America/Manaus': 'Amazonas central e oriental',
  'America/Eirunepe': 'Amazonas ocidental',
  'America/Rio_Branco': 'Acre',
  'America/Porto_Velho': 'Rondônia',
  'America/Boa_Vista': 'Roraima',
  'America/Cuiaba': 'Mato Grosso',
  'America/Campo_Grande': 'Mato Grosso do Sul',
  'America/Santarem': 'Oeste do Pará',
  'America/Noronha': 'Fernando de Noronha',
};
export default function UnitTimeZone({ unit, editable }: { unit: Unit; editable: boolean }) {
  const value = unit.timeZone || 'America/Sao_Paulo';
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy || !editable) return;
    setBusy(true);
    setError('');
    const finish = notify.saving();
    try {
      const client = createClient();
      if (!client) throw new Error('Conexão indisponível.');
      const { error } = await client.from('units').update({ time_zone: draft }).eq('id',unit.id).eq('organization_id',unit.organizationId).select('id').single();
      if (error) throw new Error(portalError(error));
      useStore.setState(state => ({ units: state.units.map(item => item.id === unit.id ? { ...item, timeZone: draft } : item) }));
      setDraft(undefined);
      notify.success('Fuso horário atualizado.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o fuso.');
    } finally {
      finish();
      setBusy(false);
    }
  }
  return <section className="nv-panel p-4">
    <h2 className="nv-section-title">Fuso horário</h2>
    <p className="mt-2 text-sm text-text-secondary">{zones[value] || value}</p>
    {editable && <button type="button" className="mt-3 nv-button-secondary" onClick={() => { setError(''); setDraft(value); }}>Alterar fuso</button>}
    {draft && <Dialog title="Fuso horário da unidade" closeDisabled={busy} onClose={() => { if (!busy) setDraft(undefined); }}>
      <form className="space-y-4" onSubmit={save}>
        <p className="text-sm text-text-secondary">O novo fuso será usado nos plantões cadastrados após a alteração.</p>
        <label className="nv-label">Fuso horário<select className="nv-input" value={draft} onChange={event => setDraft(event.target.value)}>
          {!zones[value] && <option value={value}>{value}</option>}
          {Object.entries(zones).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        {error && <p role="alert" className="nv-feedback text-danger">{error}</p>}
        <button className="nv-button" disabled={busy || draft === value}>Salvar fuso</button>
      </form>
    </Dialog>}
  </section>;
}
