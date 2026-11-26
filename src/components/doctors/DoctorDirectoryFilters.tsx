'use client';

import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { activeDirectoryFilters, directoryFilterLabels, type DirectoryFilter, type DirectoryFilters, type DirectoryResult } from '@/lib/doctorDirectory';

const labels: Record<string, string> = {
  active: 'Ativo', pending: 'Pendente', inactive: 'Inativo', with: 'Com RQE cadastrado', without: 'Sem RQE cadastrado', none: 'Sem plantões',
  pf: 'Pessoa física', pj: 'Pessoa jurídica', scp: 'SCP', signed: 'Assinado', complete: 'Completa', expired: 'Vencidos', near: 'Próximos do vencimento',
  not_released: 'Não liberado', blocked: 'Bloqueado', '30': 'Últimos 30 dias', '60': 'Últimos 60 dias', '90': 'Últimos 90 dias',
};
const advancedKeys: DirectoryFilter[] = ['unit', 'contract', 'signed', 'documents', 'portal', 'lastShift'];
export default function DoctorDirectoryFilters({ filters, data, onChange, onSearch, onClear, disabled = false }: {
  filters: DirectoryFilters; data: DirectoryResult | null; onChange: (key: DirectoryFilter, value: string) => void;
  onSearch: (value: string) => void; onClear: () => void; disabled?: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const active = activeDirectoryFilters(filters);
  const advancedCount = active.filter(key => advancedKeys.includes(key)).length;
  const select = (key: DirectoryFilter, title: string, options: [string, string][]) => <div className="min-w-0"><label htmlFor={`directory-filter-${key}`} className="nv-label">{title}</label>
    <select id={`directory-filter-${key}`} className="nv-input w-full min-w-0 pr-8" value={filters[key]} disabled={disabled} onChange={event => onChange(key, event.target.value)}>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </div>;
  return <section aria-label="Filtros de médicos" className="space-y-3 rounded-xl border border-card-border bg-card-bg p-4">
    <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(17rem,2fr)_minmax(13rem,1fr)_minmax(10rem,1fr)]">
      <div className="min-w-0"><label htmlFor="doctor-search" className="nv-label">Buscar médicos</label>
        <input ref={search} key={filters.q} id="doctor-search" type="search" defaultValue={filters.q} maxLength={150} className="nv-input w-full" placeholder="Nome, CRM, RQE ou especialidade" disabled={disabled}
          onChange={event => { if (timer.current) clearTimeout(timer.current); const value = event.currentTarget.value; timer.current = setTimeout(() => onSearch(value.trim()), 300); }}/>
      </div>
      {select('specialty', 'Especialidade', [['all', 'Todas as especialidades'], ...(data?.specialties || []).map(value => [value, value] as [string, string])])}
      {select('status', 'Status cadastral', [['all', 'Todos os status'], ['active', 'Ativo'], ['pending', 'Pendente'], ['inactive', 'Inativo']])}
      {select('rqe', 'RQE', [['all', 'Todos os médicos'], ['with', filters.specialty === 'all' ? 'Com RQE cadastrado' : 'Com RQE nesta especialidade'], ['without', filters.specialty === 'all' ? 'Sem RQE cadastrado' : 'Sem RQE vinculado à especialidade']])}
      <button type="button" aria-expanded={advanced} aria-controls="doctor-advanced-filters" className="nv-button-secondary min-h-11 justify-center md:justify-self-start" onClick={() => setAdvanced(value => !value)}>
        <SlidersHorizontal className="size-4" aria-hidden="true"/>Filtros avançados{advancedCount > 0 && <span className="tabular-nums">({advancedCount})</span>}
      </button>
    </div>
    {advanced && <div id="doctor-advanced-filters" className="grid gap-3 border-t border-border pt-4 md:grid-cols-2 xl:grid-cols-3">
      {data?.permissions.schedule && select('unit', 'Unidades atendidas', [['all', 'Todas as unidades'], ['none', 'Sem plantões vinculados'], ...data.units.map(unit => [unit.id, unit.name] as [string, string])])}
      {select('contract', 'Contratação', [['all', 'Todas as contratações'], ['pf', 'Pessoa física (PF)'], ['pj', 'Pessoa jurídica (PJ)'], ['scp', 'SCP']])}
      {select('signed', 'Situação contratual', [['all', 'Todos os contratos'], ['pending', 'Contrato pendente'], ['signed', 'Contrato assinado']])}
      {data?.permissions.documents && select('documents', 'Documentação', [['all', 'Toda documentação'], ['complete', 'Documentação completa'], ['pending', 'Com pendências'], ['expired', 'Com documentos vencidos'], ['near', 'Próximos do vencimento']])}
      {data?.permissions.portal && select('portal', 'Portal Médico', [['all', 'Todos os acessos'], ['not_released', 'Acesso não liberado'], ['pending', 'Convite pendente'], ['active', 'Acesso ativo'], ['blocked', 'Acesso bloqueado']])}
      {data?.permissions.schedule && select('lastShift', 'Último plantão realizado', [['all', 'Qualquer período'], ['30', 'Últimos 30 dias'], ['60', 'Últimos 60 dias'], ['90', 'Últimos 90 dias'], ['none', 'Sem plantões realizados']])}
    </div>}
    {active.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3" aria-label="Filtros aplicados">
      {active.map(key => <button key={key} type="button" className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg bg-surface-muted px-3 text-xs text-text-secondary hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={`Remover filtro ${directoryFilterLabels[key]}`} onClick={() => {
          if (key === 'q') { if (timer.current) clearTimeout(timer.current); if (search.current) search.current.value = ''; }
          onChange(key, key === 'q' ? '' : 'all');
        }}>
        <span className="break-words">{directoryFilterLabels[key]}: {key === 'rqe' && filters.specialty !== 'all' ? filters.rqe === 'with' ? 'Com vínculo na especialidade' : 'Sem vínculo na especialidade' : key === 'unit' ? data?.units.find(unit => unit.id === filters.unit)?.name || labels[filters.unit] || filters.unit : key === 'specialty' || key === 'q' ? filters[key] : labels[filters[key]] || filters[key]}</span><X className="size-3 shrink-0" aria-hidden="true"/>
      </button>)}
      <button type="button" className="min-h-9 px-2 text-xs font-semibold text-primary hover:underline" onClick={() => { if (timer.current) clearTimeout(timer.current); if (search.current) search.current.value = ''; onClear(); }}>Limpar filtros</button>
    </div>}
    {filters.specialty !== 'all' && filters.rqe !== 'all' && <p className="text-xs text-text-muted">O filtro de RQE considera somente registros vinculados à especialidade selecionada. Registros legados sem vínculo continuam preservados.</p>}
  </section>;
}
