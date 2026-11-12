'use client';

import { useState } from 'react';
import { canPerformAction, canViewPermission } from '@/lib/permissions';
import { useStore } from '@/store/useStore';
import type { Sector } from '@/types';
import SectorEditorDialog from './SectorEditorDialog';

export default function SectorSettings() {
  const store = useStore();
  const [unitId, setUnitId] = useState('');
  const [editing, setEditing] = useState<{ unitId: string; sector?: Sector }>();
  const company = store.organizations.find(item => item.id === store.activeOrganizationId);
  if (!company || !canViewPermission(store.currentUser, 'unidades')) return null;
  const units = store.units.filter(item => item.organizationId === company.id);
  const sectors = store.sectors.filter(item => item.organizationId === company.id && (!unitId || item.unitId === unitId));
  const unit = units.find(item => item.id === editing?.unitId);
  return <section id="setores-especialidades" className="rounded-xl border border-card-border bg-card-bg p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold">Setores e Especialidades</h3>
      <p className="mt-1 text-sm text-text-muted">Configure a especialidade principal de cada setor por unidade.</p></div>
      {canPerformAction(store.currentUser, 'unidades', 'create') && <button className="nv-button" disabled={!units.some(item => item.status === 'active')}
        onClick={() => setEditing({ unitId: units.find(item => item.id === unitId && item.status === 'active')?.id || units.find(item => item.status === 'active')?.id || '' })}>Novo setor</button>}</div>
    <label className="nv-label mt-4">Unidade<select className="nv-input" value={unitId} onChange={event => setUnitId(event.target.value)}><option value="">Todas as unidades</option>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {!sectors.length ? <p className="mt-4 text-sm text-text-muted">Nenhum setor cadastrado para esta seleção.</p> : <ul className="mt-4 divide-y divide-border">
      {sectors.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.name} <span className="font-normal text-text-muted">· {item.status === 'active' ? 'Ativo' : 'Inativo'}</span></p>
          <p className="mt-1 text-xs text-text-muted">{units.find(value => value.id === item.unitId)?.name}</p>
          <p className={`mt-1 text-sm ${item.primarySpecialty ? 'text-text-secondary' : 'text-warning'}`}>{item.primarySpecialty || 'Vinculação pendente — configure antes de criar novos plantões.'}</p></div>
        {canPerformAction(store.currentUser, 'unidades', 'edit') && <button className="nv-button-secondary" onClick={() => setEditing({ unitId: item.unitId, sector: item })}>Editar setor</button>}
      </li>)}
    </ul>}
    {editing && unit && <SectorEditorDialog key={editing.sector?.id || unit.id} unit={unit} organizationName={company.name}
      specialties={company.settings.specialties.filter(item => !unit.specialties.length || unit.specialties.includes(item))}
      sector={editing.sector} onClose={() => setEditing(undefined)} onSaved={() => setEditing(undefined)} />}
    {editing && !editing.sector && <p role="status" className="mt-2 text-xs text-text-muted">Unidade para o novo setor: {unit?.name}</p>}
  </section>;
}
