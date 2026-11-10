'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, CalendarDays, MapPin, Moon, Pencil, Plus, Stethoscope, Sun, UserRound, Users } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import UnitAttendanceSettings from '@/components/schedule/UnitAttendanceSettings';
import Dialog from '@/components/Dialog';
import SectorEditorDialog from '@/components/schedule/SectorEditorDialog';
import { scopedSpecialties } from '@/lib/sectorSpecialties';
import { canEditPermission, canPerformAction } from '@/lib/permissions';
import { coveragePeriodLabel, localDate, sectorCoveragePeriods } from '@/lib/scheduling';
import { useStore } from '@/store/useStore';
import type { Sector } from '@/types';

export default function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: unitId } = use(params);
  const store = useStore();
  const [sectorEditor, setSectorEditor] = useState<{ sector?: Sector } | null>(null);
  const [unitSpecialties, setUnitSpecialties] = useState<string[] | null>(null);
  const [unitFormError, setUnitFormError] = useState('');
  const unit = store.units.find(item => item.id === unitId && item.organizationId === store.activeOrganizationId);
  const responsibleCompany = store.organizations.find(item => item.id === unit?.organizationId);
  const sectors = store.sectors.filter(item => item.unitId === unitId && item.organizationId === store.activeOrganizationId);
  const unitShifts = store.shifts.filter(item => item.unitId === unitId && item.organizationId === store.activeOrganizationId);
  const operationalDoctorIds = new Set(unitShifts.filter(item => item.doctorId && item.status !== 'cancelled').map(item => item.doctorId));
  const doctors = store.doctors.filter(item => item.organizationId === store.activeOrganizationId && operationalDoctorIds.has(item.id));
  const upcoming = store.shifts.filter(item => item.unitId === unitId && item.organizationId === store.activeOrganizationId && item.date >= localDate() && item.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).slice(0, 8);
  const specialtyOptions = scopedSpecialties(responsibleCompany?.settings.specialties || [], unit?.specialties || []);
  const unitCatalog = [...new Set([...(responsibleCompany?.settings.specialties || []), ...(unit?.specialties || [])])];
  const canEditUnit = canEditPermission(store.currentUser, 'unidades');
  const canCreateSector = canPerformAction(store.currentUser, 'unidades', 'create');

  if (!unit) return <AccessGuard requiredPermission="unidades"><div className="py-16 text-center"><Building2 className="mx-auto mb-4 text-danger"/><h1 className="text-lg font-semibold">Unidade não encontrada</h1><Link href="/unidades" className="mt-4 inline-flex text-sm text-primary">Voltar para unidades</Link></div></AccessGuard>;

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
        <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">{unit.status === 'active' ? 'Unidade ativa' : 'Unidade inativa'}</p><h1 className="nv-page-title mt-1">{unit.name}</h1><p className="mt-2 text-sm text-text-secondary">{unit.city} · {unit.state} · {responsibleCompany?.cnpj || unit.cnpj}</p></div>
        <Link href={`/escala?unitId=${unit.id}`} className="nv-button-secondary"><CalendarDays size={16}/>Abrir escala</Link>
      </div>
    </header>

    {canEditUnit && <UnitAttendanceSettings key={unit.id} unitId={unit.id}/>}

    <section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3" aria-label="Resumo da unidade">
      <div className="bg-card-bg p-4"><p className="text-xs text-text-muted">Setores ativos</p><p className="mt-1 text-2xl font-semibold tabular-nums">{sectors.filter(item => item.status === 'active').length}</p></div>
      <div className="bg-card-bg p-4"><p className="text-xs text-text-muted">Médicos escalados</p><p className="mt-1 text-2xl font-semibold tabular-nums">{doctors.length}</p></div>
      <div className="bg-card-bg p-4"><p className="text-xs text-text-muted">Próximos postos</p><p className="mt-1 text-2xl font-semibold tabular-nums">{upcoming.length}</p></div>
    </section>

    <div className="grid gap-7 xl:grid-cols-[minmax(0,1.5fr)_minmax(290px,.7fr)]">
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold">Setores e cobertura padrão</h2><p className="mt-1 text-sm text-text-secondary">Defina onde a equipe atua e quantos médicos são esperados por dia.</p></div>
          {canCreateSector && <button className="nv-button" onClick={() => setSectorEditor({})}><Plus size={16}/>Novo setor</button>}
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
          {sectors.length === 0 ? <div className="p-10 text-center"><Stethoscope className="mx-auto mb-3 text-text-muted"/><h3 className="font-semibold">Nenhum setor cadastrado</h3><p className="mt-1 text-sm text-text-secondary">{canEditUnit ? 'Cadastre o primeiro setor para montar a grade semanal.' : 'Ainda não há setores configurados nesta unidade.'}</p></div> : <ul className="divide-y divide-border">{sectors.map(sector => <li key={sector.id} className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-state-hover"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="font-semibold">{sector.name}</p>{sector.status === 'inactive' && <span className="rounded bg-surface-muted px-2 py-0.5 text-[11px] text-text-muted">Inativo</span>}</div><p className="mt-1 text-sm text-text-secondary">{sector.specialties.length ? sector.specialties.join(' · ') : 'Especialidade ainda não definida'}</p>{sector.description && <p className='mt-1 text-sm text-text-secondary'>{sector.description}</p>}<div className="mt-3 flex flex-wrap gap-2">{sectorCoveragePeriods(sector).map(period => <span key={period.kind} className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted/50 px-2.5 py-1.5 text-xs text-text-secondary">{period.kind === 'day' ? <Sun size={13} className="text-warning"/> : <Moon size={13} className="text-primary"/>}<strong className="text-text-primary">{coveragePeriodLabel(period.kind)}</strong><span className="tabular-nums">{period.startTime}–{period.endTime}</span><span className="inline-flex items-center gap-1"><Users size={12}/>{period.requiredDoctors}</span></span>)}</div></div>{canEditUnit && <button className="p-2.5 text-text-muted hover:text-primary" aria-label={`Editar ${sector.name}`} onClick={() => setSectorEditor({ sector })}><Pencil size={16}/></button>}</li>)}</ul>}
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

    {unitSpecialties && <Dialog title="Editar especialidades da unidade" onClose={() => !store.saving && setUnitSpecialties(null)}><form onSubmit={saveUnitSpecialties} className="space-y-5"><div><p className="text-sm text-text-secondary">Selecione as especialidades atendidas em <strong className="text-text-primary">{unit.name}</strong>.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{unitCatalog.map(item => <label key={item} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition ${unitSpecialties.includes(item) ? 'border-primary/40 bg-primary/5 text-text-primary' : 'border-border text-text-secondary hover:bg-state-hover'}`}><input type="checkbox" checked={unitSpecialties.includes(item)} onChange={() => toggleUnitSpecialty(item)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary"/><span>{item}</span></label>)}{!unitCatalog.length && <p className="sm:col-span-2 rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">Cadastre primeiro as especialidades nas configurações da empresa.</p>}</div></div>{unitFormError && <p role="alert" className="text-sm text-danger">{unitFormError}</p>}<div className="flex justify-end gap-3"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={() => setUnitSpecialties(null)}>Cancelar</button><button className="nv-button" disabled={store.saving}>{store.saving ? 'Salvando…' : 'Salvar especialidades'}</button></div></form></Dialog>}

    {sectorEditor && <SectorEditorDialog unit={unit} organizationName={responsibleCompany?.name || ''} specialties={specialtyOptions} sector={sectorEditor.sector}
      onClose={() => setSectorEditor(null)} onSaved={() => setSectorEditor(null)} />}
  </div></AccessGuard>;
}
