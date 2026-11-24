'use client';

import { useEffect, useId, useState } from 'react';
import type { Doctor } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { notify } from '@/lib/notifications';
import Dialog from './Dialog';
import DoctorProfileFields, { doctorProfileFromForm } from './DoctorProfileFields';

type Snapshot = {
  profile: Record<string, unknown> & { updated_at: string }; specialties: string[];
  birth_date?: string | null; can_read_personal?: boolean; has_enrollment: boolean; can_approve: boolean; can_edit: boolean;
  enrollment_status: string; requested_specialties: string[];
};
export default function DoctorProfileEditor({ doctorId, specialties = [], own = false, onClose, onSaved }: {
  doctorId: string; specialties?: string[]; own?: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const formId = useId();
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
    if (!snapshot?.can_edit || busy) return;
    const fields = new FormData(event.currentTarget);
    if (snapshot.birth_date && fields.has('birth') && !fields.get('birth')) { setError('Informe a data de nascimento ou mantenha o valor atual.'); return; }
    const draft = doctorProfileFromForm(fields);
    const personal = snapshot.can_read_personal === false ? {} : { phone: draft.phone, address: draft.address };
    const values: Record<string, unknown> = own ? { name: draft.name, ...personal } : {
      name: draft.name, ...personal, ...(snapshot.can_read_personal === false ? {} : { cpf: draft.cpf }), crm: draft.crm, crm_uf: draft.crmUf,
      rqe: draft.rqe || null, specialty: draft.specialty, status: draft.status,
      contract_model: draft.contractModel, contract_signed: draft.contractSigned,
    };
    // Only changed fields are sent, preserving incomplete legacy values.
    const profile = Object.fromEntries(Object.entries(values).filter(([key, value]) => {
      const original = snapshot.profile[key] ?? '';
      if (key === 'address' && typeof original === 'string' && typeof value === 'string') {
        return original.replace(/\r\n/g, '\n').trim() !== value.replace(/\r\n/g, '\n');
      }
      return original !== (value ?? '');
    }));
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
      notify.success(own ? 'Seus dados foram atualizados.' : 'Perfil médico atualizado.');
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  const p = snapshot?.profile;
  const initial = p ? { ...p, crmUf: p.crm_uf, contractModel: p.contract_model, contractSigned: p.contract_signed } as unknown as Doctor : undefined;
  const profileSpecialties = snapshot?.enrollment_status === 'approved' ? snapshot.specialties : snapshot?.requested_specialties || [];
  const canEditSpecialties = !own && snapshot?.has_enrollment && (snapshot.enrollment_status === 'approved' ? snapshot.can_approve : ['pending', 'correction_requested'].includes(snapshot.enrollment_status));
  return <Dialog title={own ? 'Editar meus dados' : 'Editar perfil'} onClose={onClose} size="lg" closeDisabled={busy}
    footer={snapshot && <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="nv-button-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="submit" form={formId} className="nv-button" disabled={busy || !snapshot.can_edit}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>
      </div>
    </div>}>
    {!snapshot && !error && <p role="status">Carregando dados atuais…</p>}
    {!snapshot && error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {snapshot && <form id={formId} onSubmit={save} aria-busy={busy}>
      <fieldset disabled={busy || !snapshot.can_edit} className="min-w-0 space-y-5">
        <DoctorProfileFields initial={initial} specialties={specialties} editing own={own} personal={snapshot.can_read_personal !== false}
          birthDate={!own && snapshot.can_read_personal !== false && snapshot.has_enrollment ? snapshot.birth_date || '' : undefined}
          professionalDetails={canEditSpecialties && <fieldset className="min-w-0 sm:col-span-2">
            <legend className="nv-label">{snapshot.enrollment_status === 'approved' ? 'Especialidades autorizadas' : 'Especialidades para análise do credenciamento'}</legend>
            <div className="grid sm:grid-cols-2">{Array.from(new Set([...profileSpecialties, ...specialties])).map(s => <label key={s} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="approvedSpecialties" value={s} defaultChecked={profileSpecialties.includes(s)}/>{s}</label>)}</div>
            <input type="hidden" name="specialtiesPresent" value="1"/>
          </fieldset>}/>
        <p className="text-xs text-text-muted">{own ? 'CRM, CPF e especialidades devem ser regularizados com a coordenação.' : 'Edite documentos e dados bancários nas seções correspondentes, conforme suas permissões.'}</p>
      </fieldset>
    </form>}
  </Dialog>;
}
