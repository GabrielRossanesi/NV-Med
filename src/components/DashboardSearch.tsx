'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Building2, CalendarDays, Layers3, Search, Stethoscope } from 'lucide-react';
import { canViewPermission } from '@/lib/permissions';
import { shiftScheduleHref } from '@/lib/dashboardOverview';
import { doctorNameSearchKey } from '@/lib/doctorName';
import { useStore } from '@/store/useStore';
import Dialog from './Dialog';
import { fetchWorkspaceData } from '@/services/supabaseService';
import { workspacePlan } from '@/lib/workspaceScope';

export default function DashboardSearch({ onClose }: { onClose: () => void }) {
  const key=useStore(state=>`${state.currentUser.id}/${state.activeOrganizationId}`);
  return <CompanySearch key={key} onClose={onClose}/>;
}

function CompanySearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const { currentUser, activeOrganizationId: org } = useStore();
  const [data,setData]=useState<Awaited<ReturnType<typeof fetchWorkspaceData>>|null>(null);
  const {doctors=[],units=[],shifts=[],sectors=[]}=data||{};
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let active=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25_000);
    const plan={...workspacePlan('/escala',new URLSearchParams(),org),name:'search',shifts:'all' as const};
    void fetchWorkspaceData(plan,currentUser,controller.signal).then(result=>{if(active)setData(result);}).catch(()=>{if(active)setLoadError('Não foi possível carregar a busca. Feche e tente novamente.');}).finally(()=>clearTimeout(timeout));
    return()=>{active=false;controller.abort();clearTimeout(timeout);};
  },[org,currentUser]);
  const search = doctorNameSearchKey(query);
  const terms = search.split(' ');
  const ready = search.length >= 2;
  const matches = (name: string, detail: string) => {
    const searchable = doctorNameSearchKey(`${name} ${detail}`);
    return terms.every(term => searchable.includes(term));
  };
  const companyDoctors = doctors.filter(item => item.organizationId === org);
  const companyUnits = units.filter(item => item.organizationId === org);
  const companySectors = sectors.filter(item => item.organizationId === org);
  const doctorNames = new Map(companyDoctors.map(item => [item.id, item.name]));
  const unitNames = new Map(companyUnits.map(item => [item.id, item.name]));
  const canSeeSchedule = canViewPermission(currentUser, 'escala');
  const groups = ready && org && data ? [
    { label: 'Médicos', icon: Stethoscope, items: canViewPermission(currentUser, 'medicos') ? companyDoctors.map(doctor => ({ id: doctor.id, name: doctor.name, detail: `${doctor.specialty} · CRM ${doctor.crm}/${doctor.crmUf}`, href: `/medicos/${doctor.id}` })) : [] },
    { label: 'Unidades', icon: Building2, items: canViewPermission(currentUser, 'unidades') ? companyUnits.map(unit => ({ id: unit.id, name: unit.name, detail: [unit.city, unit.state].filter(Boolean).join(' · '), href: `/unidades/${unit.id}` })) : [] },
    { label: 'Postos e setores', icon: Layers3, items: canSeeSchedule ? companySectors.filter(sector => sector.status === 'active').map(sector => ({ id: sector.id, name: sector.name, detail: [unitNames.get(sector.unitId), ...sector.specialties].filter(Boolean).join(' · '), href: '/escala?' + new URLSearchParams({ unitId: sector.unitId, sectorId: sector.id }) })) : [] },
    { label: 'Plantões', icon: CalendarDays, items: canSeeSchedule ? shifts.filter(shift => shift.organizationId === org && shift.status !== 'cancelled').map(shift => ({ id: shift.id, name: doctorNames.get(shift.doctorId || '') || shift.sector || 'Plantão', detail: [shift.date.split('-').reverse().join('/'), `${shift.startTime}–${shift.endTime}`, unitNames.get(shift.unitId), shift.specialty].filter(Boolean).join(' · '), href: shiftScheduleHref(shift) })) : [] },
  ].map(group => ({ ...group, items: group.items.filter(item => matches(item.name, item.detail)) })).filter(group => group.items.length) : [];

  return <Dialog title="Pesquisar na empresa" onClose={onClose}>
    <label className="nv-label" htmlFor="workspace-search">Nome, CRM, unidade ou data do plantão</label>
    <div className="relative mt-2">
      <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-text-muted" />
      <input autoFocus id="workspace-search" type="search" className="nv-input pl-10" placeholder="Buscar nos dados da empresa ativa" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <p role="status" className="my-3 text-sm text-text-muted">
      {loadError || (!data ? 'Carregando busca…' : !ready ? 'Digite pelo menos dois caracteres para pesquisar.' : groups.length ? 'Até 5 resultados por categoria.' : 'Nenhum resultado para esta busca.')}
    </p>
    <div className="space-y-4">
      {groups.map(({ label, icon: Icon, items }) => <section key={label}>
        <h3 className="flex items-center gap-2 text-xs font-semibold text-text-secondary"><Icon size={15} aria-hidden="true" />{label}</h3>
        <ul className="mt-1 divide-y divide-border">
          {items.slice(0, 5).map(item => <li key={item.id}>
            <Link href={item.href} onClick={onClose} className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-state-hover">
              <span className="min-w-0 break-words"><strong className="block text-sm font-semibold">{item.name}</strong><span className="block text-xs text-text-muted">{item.detail}</span></span>
              <ArrowUpRight size={15} aria-hidden="true" className="shrink-0 text-text-muted group-hover:text-primary" />
            </Link>
          </li>)}
        </ul>
      </section>)}
    </div>
  </Dialog>;
}
