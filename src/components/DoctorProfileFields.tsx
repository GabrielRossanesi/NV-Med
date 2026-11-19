'use client';

import type { ReactNode } from 'react';
import type { Doctor } from '@/types';
import { doctorContractModelLabels } from '@/lib/doctorProfile';
import { crmStates } from '@/lib/documentRequirements';
import DoctorAddressFields from './DoctorAddressFields';

export function doctorProfileFromForm(form: FormData) {
  const value = (key: string) => String(form.get(key) ?? '').trim();
  return {
    name: value('name'), crm: value('crm'), crmUf: value('crmUf'), rqe: value('rqe'), cpf: value('cpf'),
    phone: value('phone'), email: value('email').toLowerCase(), specialty: value('specialty'), address: value('address'),
    status: value('status') as Doctor['status'], contractModel: value('contractModel') as Doctor['contractModel'],
    contractSigned: form.has('contractSigned'), linkedUnits: [] as string[],
  };
}

function ProfileGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div className="min-w-0">
    <fieldset className="min-w-0">
      <legend className="mb-3 text-sm font-semibold">{title}</legend>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4">{children}</div>
    </fieldset>
  </div>;
}

export default function DoctorProfileFields({ initial = {}, specialties, editing = false, own = false, birthDate, professionalDetails }: {
  initial?: Partial<Doctor>; specialties: string[]; editing?: boolean; own?: boolean;
  birthDate?: string; professionalDetails?: ReactNode;
}) {
  const options = Array.from(new Set([initial.specialty, ...specialties].filter((s): s is string => Boolean(s))));
  return <div className="space-y-5 [&>div+div]:border-t [&>div+div]:border-border [&>div+div]:pt-4">
    <ProfileGroup title="Identificação pessoal">
      <label className="nv-label sm:col-span-2">Nome completo<input name="name" className="nv-input" defaultValue={initial.name} required maxLength={150} autoComplete="name"/></label>
      <label className="nv-label">CPF<input name="cpf" className="nv-input" defaultValue={initial.cpf} readOnly={own} required={!editing} maxLength={14} inputMode="numeric"/></label>
      {birthDate !== undefined && <label className="nv-label">Nascimento<input className="nv-input" name="birth" type="date" defaultValue={birthDate}/></label>}
    </ProfileGroup>
    <ProfileGroup title="Identificação profissional">
      <label className="nv-label">CRM<input name="crm" className="nv-input" defaultValue={initial.crm} readOnly={own} required={!editing} maxLength={12} inputMode="numeric"/></label>
      <label className="nv-label">UF do CRM<select name="crmUf" className="nv-input" defaultValue={initial.crmUf || 'SP'} disabled={own}>{crmStates.map(uf => <option key={uf}>{uf}</option>)}</select></label>
      <label className="nv-label">RQE<input name="rqe" className="nv-input" defaultValue={initial.rqe} readOnly={own} maxLength={20} inputMode="numeric"/></label>
      <label className="nv-label">Especialidade principal<select name="specialty" className="nv-input" defaultValue={initial.specialty || options[0]} disabled={own} required={!editing}>{options.map(s => <option key={s}>{s}</option>)}</select></label>
      {professionalDetails}
    </ProfileGroup>
    <ProfileGroup title="Contatos">
      <label className="nv-label">Telefone<input name="phone" className="nv-input" type="tel" defaultValue={initial.phone} required={!editing} maxLength={40} autoComplete="tel"/></label>
      <label className="nv-label">E-mail<input name="email" className="nv-input" type="email" defaultValue={initial.email} required={!editing} readOnly={editing} maxLength={254} autoComplete="email"/>
        {editing && <span className="text-xs font-normal text-text-muted">{own ? 'Alterações de acesso dependem da administração.' : 'Altere na seção Acesso ao Portal Médico.'}</span>}</label>
    </ProfileGroup>
    <ProfileGroup title="Endereço">
      <DoctorAddressFields initialAddress={initial.address} required={!editing}/>
    </ProfileGroup>
    {!own && <ProfileGroup title="Contratação">
      <label className="nv-label">Modelo de contratação<select name="contractModel" className="nv-input" defaultValue={initial.contractModel || 'pf'}>{Object.entries(doctorContractModelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="nv-label">Status do cadastro<select name="status" className="nv-input" defaultValue={initial.status || 'active'}><option value="active">Ativo</option><option value="pending">Pendente</option><option value="inactive">Inativo</option></select></label>
      <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2"><input name="contractSigned" type="checkbox" defaultChecked={initial.contractSigned}/>Contrato já assinado</label>
    </ProfileGroup>}
  </div>;
}
