'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, CalendarDays, Clock3, MapPin, Pencil, Plus, Stethoscope, UserRound, Users } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import Dialog from '@/components/Dialog';
import { canEditPermission } from '@/lib/permissions';
import { localDate } from '@/lib/scheduling';
import { useStore } from '@/store/useStore';
import type { Sector } from '@/types';

type SectorDraft = Omit<Sector, 'id' | 'organizationId' | 'unitId'> & { id?: string };
const emptySector: SectorDraft = { name: '', specialties: [], status: 'active', defaultStartTime: '07:00', defaultEndTime: '19:00', requiredDoctors: 1 };

export default function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: unitId } = use(params);
  const store = useStore();
  const [draft, setDraft] = useState<SectorDraft | null>(null);
  const [specialty, setSpecialty] = useState('');
  const [formError, setFormError] = useState('');
  const [unitSpecialties, setUnitSpecialties] = useState<string[] | null>(null);
  const [unitFormError, setUnitFormError] = useState('');
  const unit = store.units.find(item => item.id === unitId && item.organizationId === store.activeOrganizationId);
  const responsibleCompany = store.organizations.find(item => item.id === unit?.organizationId);
  const sectors = store.sectors.filter(item => item.unitId === unitId && item.organizationId === store.activeOrganizationId);
  const unitShifts = store.shifts.filter(item => item.unitId === unitId && item.organizationId === store.activeOrganizationId);
  const operationalDoctorIds = new Set(unitShifts.filter(item => item.doctorId && item.status !== 'cancelled').map(item => item.doctorId));
  const doctors = store.doctors.filter(item => item.organizationId === store.activeOrganizationId && operationalDoctorIds.has(item.id));
  const upcoming = store.shifts.filter(item => item.unitId === unitId && item.organizationId === store.activeOrganizationId && item.date >= localDate() && item.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).slice(0, 8);
  const specialtyOptions = useMemo(() => [...new Set([...(unit?.specialties || []), ...(responsibleCompany?.settings.specialties || [])].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [unit, responsibleCompany]);
  const canEditUnit = canEditPermission(store.currentUser, 'unidades');

  if (!unit) return <AccessGuard requiredPermission="unidades"><div className="py-16 text-center"><Building2 className="mx-auto mb-4 text-danger"/><h1 className="text-lg font-semibold">Unidade não encontrada</h1><Link href="/unidades" className="mt-4 inline-flex text-sm text-primary">Voltar para unidades</Link></div></AccessGuard>;

  function openSector(sector?: Sector) {
    setSpecialty(''); setFormError('');
    setDraft(sector ? { id: sector.id, name: sector.name, specialties: sector.specialties, status: sector.status, defaultStartTime: sector.defaultStartTime, defaultEndTime: sector.defaultEndTime, requiredDoctors: sector.requiredDoctors } : { ...emptySector });
  }
  async function saveSector(event: React.FormEvent) {
    event.preventDefault(); if (!draft) return;
    if (!canEditUnit) return setFormError('Seu acesso permite apenas visualizar unidades.');
    if (!draft.name.trim()) return setFormError('Informe o nome do setor.');
    if (draft.defaultStartTime === draft.defaultEndTime) return setFormError('Início e fim precisam ser diferentes.');
    const payload = { ...draft, name: draft.name.trim(), specialties: [...new Set(draft.specialties.map(item => item.trim()).filter(Boolean))] };
    const ok = draft.id ? await store.updateSector({ ...payload, id: draft.id, organizationId: store.activeOrganizationId, unitId }) : await store.addSector({ ...payload, unitId });
    if (ok) setDraft(null); else setFormError(useStore.getState().error || 'Não foi possível salvar o setor.');
  }
  function addSpecialty() {
    if (!draft || !specialty.trim()) return;
    setDraft({ ...draft, specialties: [...new Set([...draft.specialties, specialty.trim()])] }); setSpecialty('');
  }
  function openUnitSpecialties() {
    if (!unit) return;
    setUnitFormError('');
    setUnitSpecialties([...unit.specialties]);
  }
  function toggleUnitSpecialty(value: string) {
    if (!unitSpecialties) return;
    setUnitSpecialties(unitSpecialties.includes(value) ? unitSpecialties.filter(item => item !== value) : [...unitSpecialties, value]);
  }
  async function saveUnitSpecialties(event: React.FormEvent) {
    event.preventDefault();
    if (!unit || !unitSpecialties || !canEditUnit) return;
    const specialties = [...new Set(unitSpecialties)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (await store.updateUnit({ ...unit, specialties })) setUnitSpecialties(null);
    else setUnitFormError(useStore.getState().error || 'Não foi possível atualizar as especialidades.');
  }

  return <AccessGuard requiredPermission="unidades"><div className="space-y-7">
    <header>
      <Link href="/unidades" className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary"><ArrowLeft size={16}/>Unidades</Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">{unit.status === 'active' ? 'Unidade ativa' : 'Unidade inativa'}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{unit.name}</h1><p className="mt-2 text-sm text-text-secondary">{unit.city} · {unit.state} · {responsibleCompany?.cnpj || unit.cnpj}</p></div>
        <Link href={`/escala?unitId=${unit.id}`} className="nv-button-secondary"><CalendarDays size={16}/>Abrir escala</Link>
      </div>
    </header>

    <section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3" aria-label="Resumo da unidade">
      <div className="bg-card-bg p-4"><p className="text-xs text-text-muted">Setores ativos</p><p className="mt-1 text-2xl font-semibold tabular-nums">{sectors.filter(item => item.status === 'active').length}</p></div>
      <div className="bg-card-bg p-4"><p className="text-xs text-text-muted">Médicos escalados</p><p className="mt-1 text-2xl font-semibold tabular-nums">{doctors.length}</p></div>
      <div className="bg-card-bg p-4"><p className="text-xs text-text-muted">Próximos postos</p><p className="mt-1 text-2xl font-semibold tabular-nums">{upcoming.length}</p></div>
    </section>

    <div className="grid gap-7 xl:grid-cols-[minmax(0,1.5fr)_minmax(290px,.7fr)]">
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold">Setores e cobertura padrão</h2><p className="mt-1 text-sm text-text-secondary">Defina onde a equipe atua e quantos médicos são esperados por dia.</p></div>
          {canEditUnit && <button className="nv-button" onClick={() => openSector()}><Plus size={16}/>Novo setor</button>}
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
          {sectors.length === 0 ? <div className="p-10 text-center"><Stethoscope className="mx-auto mb-3 text-text-muted"/><h3 className="font-semibold">Nenhum setor cadastrado</h3><p className="mt-1 text-sm text-text-secondary">{canEditUnit ? 'Cadastre o primeiro setor para montar a grade semanal.' : 'Ainda não há setores configurados nesta unidade.'}</p></div> : <ul className="divide-y divide-border">{sectors.map(sector => <li key={sector.id} className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-state-hover"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-semibold">{sector.name}</p>{sector.status === 'inactive' && <span className="rounded bg-surface-muted px-2 py-0.5 text-[11px] text-text-muted">Inativo</span>}</div><p className="mt-1 text-sm text-text-secondary">{sector.specialties.length ? sector.specialties.join(' · ') : 'Especialidade ainda não definida'}</p><p className="mt-2 flex items-center gap-3 text-xs text-text-muted"><span className="inline-flex items-center gap-1"><Clock3 size={13}/>{sector.defaultStartTime}–{sector.defaultEndTime}</span><span className="inline-flex items-center gap-1"><Users size={13}/>{sector.requiredDoctors} médico{sector.requiredDoctors === 1 ? '' : 's'} por dia</span></p></div>{canEditUnit && <button className="p-2.5 text-text-muted hover:text-primary" aria-label={`Editar ${sector.name}`} onClick={() => openSector(sector)}><Pencil size={16}/></button>}</li>)}</ul>}
        </div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-xl border border-border bg-card-bg p-5"><h2 className="flex items-center gap-2 font-semibold"><MapPin size={17} className="text-primary"/>Informações</h2><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-text-muted">Endereço</dt><dd className="mt-1">{unit.address}, {unit.city} – {unit.state}</dd></div><div><dt className="text-xs text-text-muted">Empresa responsável</dt><dd className="mt-1">{responsibleCompany?.name || unit.manager || 'Não informado'}</dd></div><div><dt className="text-xs text-text-muted">CNPJ da empresa</dt><dd className="mt-1 font-mono">{responsibleCompany?.cnpj || unit.cnpj || 'Não informado'}</dd></div><div><dt className="text-xs text-text-muted">Telefone</dt><dd className="mt-1">{unit.phone || 'Não informado'}</dd></div></dl></section>

        <section className="rounded-xl border border-border bg-card-bg p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><Stethoscope size={17} className="text-primary"/>Especialidades da unidade</h2>{canEditUnit && <button type="button" onClick={openUnitSpecialties} className="rounded-lg p-2 text-text-muted transition hover:bg-state-hover hover:text-primary" aria-label="Editar especialidades da unidade"><Pencil size={15}/></button>}</div>
          <div className="mt-4 flex flex-wrap gap-2">{unit.specialties.map(item => <span key={item} className="rounded-md border border-border bg-surface-muted px-2.5 py-1 text-xs text-text-secondary">{item}</span>)}{!unit.specialties.length && <p className="text-sm text-text-muted">Nenhuma especialidade definida.</p>}</div>
        </section>

        <section className="rounded-xl border border-border bg-card-bg p-5"><h2 className="flex items-center gap-2 font-semibold"><UserRound size={17} className="text-primary"/>Corpo clínico</h2><div className="mt-4 space-y-3">{doctors.slice(0,5).map(doctor => <Link key={doctor.id} href={`/medicos/${doctor.id}`} className="block text-sm hover:text-primary"><span className="font-medium">{doctor.name}</span><span className="block text-xs text-text-muted">{doctor.specialty}</span></Link>)}{doctors.length === 0 && <p className="text-sm text-text-muted">Nenhum médico escalado nesta unidade.</p>}</div></section>
      </aside>
    </div>

    {unitSpecialties && <Dialog title="Editar especialidades da unidade" onClose={() => !store.saving && setUnitSpecialties(null)}><form onSubmit={saveUnitSpecialties} className="space-y-5"><div><p className="text-sm text-text-secondary">Selecione as especialidades atendidas em <strong className="text-text-primary">{unit.name}</strong>.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{specialtyOptions.map(item => <label key={item} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition ${unitSpecialties.includes(item) ? 'border-primary/40 bg-primary/5 text-text-primary' : 'border-border text-text-secondary hover:bg-state-hover'}`}><input type="checkbox" checked={unitSpecialties.includes(item)} onChange={() => toggleUnitSpecialty(item)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary"/><span>{item}</span></label>)}{!specialtyOptions.length && <p className="sm:col-span-2 rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">Cadastre primeiro as especialidades nas configurações da empresa.</p>}</div></div>{unitFormError && <p role="alert" className="text-sm text-danger">{unitFormError}</p>}<div className="flex justify-end gap-3"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={() => setUnitSpecialties(null)}>Cancelar</button><button className="nv-button" disabled={store.saving}>{store.saving ? 'Salvando…' : 'Salvar especialidades'}</button></div></form></Dialog>}

    {draft && <Dialog title={draft.id ? 'Editar setor' : 'Novo setor'} onClose={() => !store.saving && setDraft(null)}><form onSubmit={saveSector} className="space-y-4"><label className="nv-label">Nome do setor<input className="nv-input" autoFocus maxLength={100} required placeholder="Ex.: UTI adulto" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Início padrão<input className="nv-input" type="time" required value={draft.defaultStartTime} onChange={event => setDraft({ ...draft, defaultStartTime: event.target.value })}/></label><label className="nv-label">Fim padrão<input className="nv-input" type="time" required value={draft.defaultEndTime} onChange={event => setDraft({ ...draft, defaultEndTime: event.target.value })}/></label></div><div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Médicos esperados por dia<input className="nv-input" type="number" min={1} max={99} required value={draft.requiredDoctors} onChange={event => setDraft({ ...draft, requiredDoctors: Number(event.target.value) })}/></label><label className="nv-label">Situação<select className="nv-input" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Sector['status'] })}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label></div><div><label className="nv-label">Especialidades aceitas<div className="flex gap-2"><input className="nv-input" list="specialty-options" placeholder="Ex.: Medicina intensiva" value={specialty} onChange={event => setSpecialty(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSpecialty(); } }}/><button type="button" className="nv-button-secondary" onClick={addSpecialty}>Adicionar</button></div></label><datalist id="specialty-options">{specialtyOptions.map(item => <option key={item} value={item}/>)}</datalist><div className="mt-2 flex flex-wrap gap-2">{draft.specialties.map(item => <button type="button" key={item} className="rounded-md bg-surface-muted px-2.5 py-1 text-xs" onClick={() => setDraft({ ...draft, specialties: draft.specialties.filter(value => value !== item) })}>{item} ×</button>)}</div></div>{formError && <p role="alert" className="text-sm text-danger">{formError}</p>}<div className="flex justify-end gap-3 pt-2"><button type="button" className="nv-button-secondary" onClick={() => setDraft(null)}>Cancelar</button><button className="nv-button" disabled={store.saving}>{store.saving ? 'Salvando…' : 'Salvar setor'}</button></div></form></Dialog>}
  </div></AccessGuard>;
}
