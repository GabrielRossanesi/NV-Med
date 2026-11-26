'use client';

import { directoryColumns, type DirectoryColumn, type DoctorListingPreferences } from '@/lib/doctorDirectory';

const labels: Record<DirectoryColumn, string> = { crm: 'CRM / UF e RQE', specialty: 'Especialidade', contract: 'Contratação', units: 'Unidades atendidas', status: 'Status', documents: 'Documentação' };
export default function DoctorListingPreferenceFields({ value, onChange, disabled, documents, schedule }: { value: DoctorListingPreferences; onChange: (value: DoctorListingPreferences) => void; disabled: boolean; documents: boolean; schedule: boolean }) {
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Médicos por página<select aria-label="Médicos por página" className="nv-input" value={value.pageSize} disabled={disabled} onChange={event => onChange({ ...value, pageSize: Number(event.target.value) as 25 | 50 | 100 })}>{[25,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <label className="nv-label">Ordenação preferencial<select aria-label="Ordenação preferencial" className="nv-input" value={value.sort} disabled={disabled} onChange={event => onChange({ ...value, sort: event.target.value as DoctorListingPreferences['sort'] })}><option value="name">Nome</option><option value="crm">CRM</option><option value="specialty">Especialidade</option><option value="status">Status cadastral</option>{documents && <option value="pending">Pendências documentais</option>}</select></label></div>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={value.descending} disabled={disabled} onChange={event => onChange({ ...value, descending: event.target.checked })}/>Ordem decrescente</label>
    <fieldset><legend className="nv-label">Colunas visíveis</legend><p className="mb-2 text-xs text-text-muted">Nome, CRM, status, seleção e ações permanecem disponíveis.</p>
      <div className="grid sm:grid-cols-2">{directoryColumns.filter(column => column !== 'documents' || documents).filter(column => column !== 'units' || schedule).map(column => <label key={column} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={disabled || column === 'crm' || column === 'status'} checked={value.columns.includes(column)} onChange={event => onChange({ ...value, columns: event.target.checked ? [...value.columns, column] : value.columns.filter(item => item !== column) })}/>{labels[column]}</label>)}</div>
    </fieldset>
  </div>;
}
