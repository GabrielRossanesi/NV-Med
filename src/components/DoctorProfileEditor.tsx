'use client';

import { useEffect, useState } from 'react';
import type { Doctor } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import Dialog from './Dialog';
import DoctorProfileFields, { doctorProfileFromForm } from './DoctorProfileFields';

type Snapshot = {
  profile: Record<string, unknown> & { updated_at: string }; specialties: string[];
  birth_date: string | null; has_enrollment: boolean; can_approve: boolean; can_edit: boolean;
  enrollment_status: string; requested_specialties: string[];
};
export default function DoctorProfileEditor({ doctorId, specialties = [], own = false, onClose, onSaved }: {
  doctorId: string; specialties?: string[]; own?: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await createClient()?.rpc('nv_doctor_profile', { target: doctorId });
        if (!result || result.error) throw new Error('Não foi possível carregar o perfil. Reabra o formulário.');
        if (live) setSnapshot(result.data);
      } catch (failure) { if (live) setError((failure as Error).message); }
    })();
    return () => { live = false; };
  }, [doctorId]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    const fields = new FormData(event.currentTarget);
    if (snapshot.birth_date && fields.has('birth') && !fields.get('birth')) { setError('Informe a data de nascimento ou mantenha o valor atual.'); return; }
    const draft = doctorProfileFromForm(fields);
    const values: Record<string, unknown> = own ? { name: draft.name, phone: draft.phone, address: draft.address } : {
      name: draft.name, phone: draft.phone, address: draft.address, crm: draft.crm, crm_uf: draft.crmUf,
      cpf: draft.cpf, rqe: draft.rqe || null, specialty: draft.specialty, status: draft.status,
      contract_model: draft.contractModel, contract_signed: draft.contractSigned,
    };
    // Only changed fields are sent, preserving incomplete legacy values.
    const profile = Object.fromEntries(Object.entries(values).filter(([key, value]) => (snapshot.profile[key] ?? '') !== (value ?? '')));
    setBusy(true); setError('');
    try {
      const result = await createClient()?.rpc('nv_update_doctor_profile', {
        target: doctorId, profile, revision: snapshot.profile.updated_at,
        specialties: fields.has('specialtiesPresent') ? fields.getAll('approvedSpecialties') : null,
        birth: fields.get('birth') || null,
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      onSaved();
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  const p = snapshot?.profile;
  const initial = p ? { ...p, crmUf: p.crm_uf, contractModel: p.contract_model, contractSigned: p.contract_signed } as unknown as Doctor : undefined;
  const profileSpecialties = snapshot?.enrollment_status === 'approved' ? snapshot.specialties : snapshot?.requested_specialties || [];
  return <Dialog title={own ? 'Editar meus dados' : 'Editar perfil médico'} onClose={() => { if (!busy) onClose(); }} size="lg">
    {!snapshot && !error && <p role="status">Carregando dados atuais…</p>}
    {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
    {snapshot && <form onSubmit={save} className="space-y-5">
      <fieldset disabled={busy || !snapshot.can_edit} className="space-y-5">
        <DoctorProfileFields initial={initial} specialties={specialties} editing own={own}/>
        {!own && snapshot.has_enrollment && <label className="nv-label">Nascimento<input className="nv-input" name="birth" type="date" defaultValue={snapshot.birth_date || ''}/></label>}
        {!own && snapshot.has_enrollment && (snapshot.enrollment_status === 'approved' ? snapshot.can_approve : ['pending', 'correction_requested'].includes(snapshot.enrollment_status)) && <fieldset className="space-y-2"><legend className="nv-label">{snapshot.enrollment_status === 'approved' ? 'Especialidades autorizadas' : 'Especialidades para análise do credenciamento'}</legend>
          {Array.from(new Set([...profileSpecialties, ...specialties])).map(s => <label key={s} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="approvedSpecialties" value={s} defaultChecked={profileSpecialties.includes(s)}/>{s}</label>)}
          <input type="hidden" name="specialtiesPresent" value="1"/>
        </fieldset>}
        <p className="text-xs text-text-muted">{own ? 'CRM, CPF e especialidades devem ser regularizados com a coordenação.' : 'Documentação e dados bancários são editados nas seções correspondentes, com permissões próprias.'}</p>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="nv-button-secondary" onClick={onClose}>Cancelar</button><button className="nv-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>
      </fieldset>
    </form>}
  </Dialog>;
}
