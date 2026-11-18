'use client';

import type { Doctor } from '@/types';
import { doctorContractModelLabels } from '@/lib/doctorProfile';
import { crmStates } from '@/lib/documentRequirements';

export function doctorProfileFromForm(form: FormData) {
  const value = (key: string) => String(form.get(key) ?? '').trim();
  return {
    name: value('name'), crm: value('crm'), crmUf: value('crmUf'), rqe: value('rqe'), cpf: value('cpf'),
    phone: value('phone'), email: value('email').toLowerCase(), specialty: value('specialty'), address: value('address'),
    status: value('status') as Doctor['status'], contractModel: value('contractModel') as Doctor['contractModel'],
    contractSigned: form.has('contractSigned'), linkedUnits: [] as string[],
  };
}

export default function DoctorProfileFields({ initial = {}, specialties, editing = false, own = false }: {
  initial?: Partial<Doctor>; specialties: string[]; editing?: boolean; own?: boolean;
}) {
  const options = Array.from(new Set([initial.specialty, ...specialties].filter((s): s is string => Boolean(s))));
  return <div className="grid gap-4 sm:grid-cols-2">
    <label className="nv-label">Nome completo<input name="name" className="nv-input" defaultValue={initial.name} required maxLength={150} autoComplete="name"/></label>
    <label className="nv-label">Telefone<input name="phone" className="nv-input" type="tel" defaultValue={initial.phone} required={!editing} maxLength={40} autoComplete="tel"/></label>
    <label className="nv-label">E-mail<input name="email" className="nv-input" type="email" defaultValue={initial.email} required={!editing} readOnly={editing} maxLength={254} autoComplete="email"/>
      {editing && <span className="text-xs font-normal text-text-muted">{own ? 'Alterações de acesso dependem da administração.' : 'Altere na seção Acesso ao Portal Médico.'}</span>}</label>
    <label className="nv-label">Especialidade principal<select name="specialty" className="nv-input" defaultValue={initial.specialty || options[0]} disabled={own} required={!editing}>{options.map(s => <option key={s}>{s}</option>)}</select></label>
    <label className="nv-label">CRM<input name="crm" className="nv-input" defaultValue={initial.crm} readOnly={own} required={!editing} maxLength={12} inputMode="numeric"/></label>
    <label className="nv-label">UF do CRM<select name="crmUf" className="nv-input" defaultValue={initial.crmUf || 'SP'} disabled={own}>{crmStates.map(uf => <option key={uf}>{uf}</option>)}</select></label>
    <label className="nv-label">RQE<input name="rqe" className="nv-input" defaultValue={initial.rqe} readOnly={own} maxLength={20} inputMode="numeric"/></label>
    <label className="nv-label">CPF<input name="cpf" className="nv-input" defaultValue={initial.cpf} readOnly={own} required={!editing} maxLength={14} inputMode="numeric"/></label>
    {!own && <>
      <label className="nv-label">Status do cadastro<select name="status" className="nv-input" defaultValue={initial.status || 'active'}><option value="active">Ativo</option><option value="pending">Pendente</option><option value="inactive">Inativo</option></select></label>
      <label className="nv-label">Modelo de contratação<select name="contractModel" className="nv-input" defaultValue={initial.contractModel || 'pf'}>{Object.entries(doctorContractModelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2"><input name="contractSigned" type="checkbox" defaultChecked={initial.contractSigned}/>Contrato já assinado</label>
    </>}
    <label className="nv-label sm:col-span-2">Endereço residencial<input name="address" className="nv-input" defaultValue={initial.address} maxLength={500} required={!editing} autoComplete="street-address"/></label>
  </div>;
}
