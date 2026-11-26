'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Clock3, CircleSlash } from 'lucide-react';
import { getDoctorInitial } from '@/lib/doctorName';
import { activeDirectoryFilters, directoryDocumentLabel, directoryStatusLabels, type DirectoryColumn, type DirectoryDoctor, type DirectoryQuery, type DirectoryResult, type DirectorySort } from '@/lib/doctorDirectory';
import UserAvatar from '../UserAvatar';
import ContextMenu from '../ContextMenu';
import DetailList from '../DetailList';

export default function DoctorDirectoryTable({ data, query, columns, compact, selected, onSelect, onSelectPage, onSort, onStatus, returnTo, canEdit, canDocuments, canPortal, canSchedule }: {
  data: DirectoryResult; query: DirectoryQuery; columns: DirectoryColumn[]; compact: boolean;
  selected: Set<string>; onSelect: (doctor: DirectoryDoctor) => void; onSelectPage: () => void;
  onSort: (sort: DirectorySort) => void; onStatus: (doctor: DirectoryDoctor) => void; returnTo: string;
  canEdit: boolean; canDocuments: boolean; canPortal: boolean; canSchedule: boolean;
}) {
  const profile = (doctor: DirectoryDoctor, section = '', edit = false) => `/medicos/${encodeURIComponent(doctor.id)}?returnTo=${encodeURIComponent(returnTo)}${edit ? section === 'doctor-contract' ? '&edit=contract' : '&edit=1' : ''}${section ? `#${section}` : ''}`;
  const show = (column: DirectoryColumn) => columns.includes(column);
  const allSelected = data.rows.length > 0 && data.rows.every(doctor => selected.has(doctor.id));
  const cell = compact ? 'px-4 py-2' : 'p-4';
  const visibleColumns = columns.filter(column => column !== 'documents' || data.permissions.documents).filter(column => column !== 'units' || data.permissions.schedule);
  const heading = (label: string, sort?: DirectorySort) => <th scope="col" className="px-4 py-3" aria-sort={sort && query.sort === sort ? query.descending ? 'descending' : 'ascending' : undefined}>
    {sort ? <button type="button" className="inline-flex min-h-9 items-center gap-2 text-left hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onSort(sort)}>{label}
      {query.sort === sort ? query.descending ? <ArrowDown className="size-3.5"/> : <ArrowUp className="size-3.5"/> : <ArrowUpDown className="size-3.5 opacity-50"/>}
    </button> : label}
  </th>;
  return <div className="overflow-hidden rounded-xl border border-card-border bg-card-bg">
    <div className="max-h-[70dvh] overflow-auto focus-visible:outline-2 focus-visible:outline-primary" role="region" aria-label="Tabela de médicos" tabIndex={0} data-directory-query={JSON.stringify(query)}>
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Corpo clínico da empresa selecionada</caption>
        <thead className="sticky top-0 z-10 bg-surface-muted text-xs font-semibold text-text-secondary"><tr className="border-b border-border">
          <th scope="col" className="px-2 py-3"><label className="inline-flex size-11 items-center justify-center"><input type="checkbox" className="size-4 accent-primary" aria-label="Selecionar médicos da página atual" disabled={!data.rows.length} checked={allSelected}
            ref={element => { if (element) element.indeterminate = !allSelected && selected.size > 0; }} onChange={onSelectPage}/></label></th>
          {heading('Médico', 'name')}{show('crm') && heading('CRM / UF', 'crm')}{show('specialty') && heading('Especialidade', 'specialty')}
          {show('contract') && heading('Contratação')}{show('units') && data.permissions.schedule && heading('Unidades atendidas')}
          {show('status') && heading('Status', 'status')}{show('documents') && data.permissions.documents && heading('Documentação', 'pending')}
          {heading('Ações')}
        </tr></thead>
        <tbody className="divide-y divide-border">
          {data.rows.map(doctor => <tr key={doctor.id} className="transition-colors hover:bg-state-hover" data-selected={selected.has(doctor.id) || undefined}>
            <td className={compact ? 'px-2 py-2' : 'px-2 py-4'}><label className="inline-flex size-11 items-center justify-center"><input type="checkbox" className="size-4 accent-primary" aria-label={`Selecionar ${doctor.name || `CRM ${doctor.crm}`}`} checked={selected.has(doctor.id)} onChange={() => onSelect(doctor)}/></label></td>
            <td className={cell}><div className="flex min-w-48 items-center gap-3">
              <UserAvatar name={doctor.name} initials={getDoctorInitial(doctor.name)} className="h-8 w-8"/>
              <Link href={profile(doctor)} className="block max-w-72 break-words font-semibold text-text-primary underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary" title={doctor.name}>{doctor.name || 'Nome não informado'}</Link>
            </div></td>
            {show('crm') && <td className={cell}><span className="block whitespace-nowrap font-mono font-medium text-text-primary">{doctor.crm} / {doctor.crmUf}</span>
              {doctor.rqes.length === 0 ? <span className="mt-1 block whitespace-nowrap text-text-muted">RQE não informado</span> : <DetailList label={`RQEs de ${doctor.name}`} summary={<>RQE {doctor.rqes[0].number}{doctor.rqes.length > 1 && ` · +${doctor.rqes.length - 1} RQE${doctor.rqes.length > 2 ? 's' : ''}`}</>}>
                <ul className="space-y-2">{doctor.rqes.map((rqe, index) => <li key={rqe.id || `legacy-${index}`}><span className="font-mono">{rqe.number}</span><span className="block text-xs text-text-muted">{rqe.specialty || 'Sem vínculo de especialidade identificado'}</span></li>)}</ul>
                <p className="mt-3 text-xs text-text-muted">Registro cadastrado; não representa validação oficial.</p>
              </DetailList>}
            </td>}
            {show('specialty') && <td className={`${cell} text-text-secondary`}><span className="block min-w-32 max-w-48 break-words">{doctor.specialty}</span>
              {doctor.specialties.length > 1 && <DetailList label={`Especialidades de ${doctor.name}`} summary={`+${doctor.specialties.length - 1} especialidade${doctor.specialties.length > 2 ? 's' : ''}`}>
                <ul className="space-y-2">{doctor.specialties.map(specialty => <li key={specialty}>{specialty}{specialty === doctor.specialty && <span className="block text-xs text-text-muted">Principal</span>}</li>)}</ul>
              </DetailList>}
            </td>}
            {show('contract') && <td className={cell}><span className="block font-medium text-text-secondary">{doctor.contractModel.toUpperCase()}</span><span className="mt-1 block whitespace-nowrap text-text-muted">{doctor.contractSigned ? 'Contrato assinado' : 'Contrato pendente'}</span></td>}
            {show('units') && data.permissions.schedule && <td className={cell}>{doctor.units.length ? <>
              <span className="block min-w-28 max-w-48 break-words text-text-secondary">{doctor.units[0].name}</span>
              {doctor.units.length > 1 && <DetailList label={`Unidades atendidas por ${doctor.name}`} summary={`+${doctor.units.length - 1} unidade${doctor.units.length > 2 ? 's' : ''}`}><ul className="space-y-2">{doctor.units.map(unit => <li key={unit.id}>{unit.name}</li>)}</ul></DetailList>}
            </> : <span className="whitespace-nowrap text-text-muted">Sem plantões</span>}</td>}
            {show('status') && <td className={cell}><span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${doctor.status === 'active' ? 'text-success' : doctor.status === 'pending' ? 'text-warning' : 'text-text-muted'}`}>
              {doctor.status === 'active' ? <CheckCircle2 className="size-3.5"/> : doctor.status === 'pending' ? <Clock3 className="size-3.5"/> : <CircleSlash className="size-3.5"/>}{directoryStatusLabels[doctor.status]}</span></td>}
            {show('documents') && data.permissions.documents && <td className={cell}><Link href={`/documentos/${encodeURIComponent(doctor.id)}`} className={`block min-w-32 font-medium underline-offset-4 hover:underline ${doctor.documents?.expired ? 'text-danger' : doctor.documents?.complete ? 'text-success' : 'text-warning'}`}>
              {doctor.documents?.expired ? 'Documentos vencidos' : doctor.documents?.pending ? `${doctor.documents.pending} pendência${doctor.documents.pending === 1 ? '' : 's'}` : doctor.documents?.near ? 'Próximos do vencimento' : 'Completa'}
            </Link>{doctor.documents && !doctor.documents.complete && <DetailList label={`Situação documental de ${doctor.name}`} summary="Ver detalhes"><p>{directoryDocumentLabel(doctor.documents)}</p>{doctor.documents.missing > 0 && <p className="mt-2 text-xs text-text-muted">{doctor.documents.missing} requisito(s) sem documento cadastrado.</p>}</DetailList>}</td>}
            <td className={cell}><ContextMenu label={`Ações de ${doctor.name || `CRM ${doctor.crm}`}`}>
              <Link role="menuitem" href={profile(doctor)}>Visualizar perfil</Link>
              {canEdit && <Link role="menuitem" href={profile(doctor, '', true)}>Editar cadastro</Link>}
              {canDocuments && <Link role="menuitem" href={`/documentos/${encodeURIComponent(doctor.id)}`}>Gerenciar documentação</Link>}
              {canSchedule && <Link role="menuitem" href={profile(doctor, 'doctor-shifts')}>Visualizar plantões</Link>}
              {canEdit && <Link role="menuitem" href={profile(doctor, 'doctor-contract', true)}>Gerenciar contrato</Link>}
              {canPortal && <Link role="menuitem" href={profile(doctor, 'doctor-access')}>Gerenciar acesso ao Portal Médico</Link>}
              <Link role="menuitem" href={profile(doctor, 'doctor-history')}>Histórico de alterações</Link>
              {canEdit && <div className="mt-1 border-t border-border pt-1"><button type="button" role="menuitem" className={doctor.status === 'inactive' ? 'text-success' : 'text-danger'} onClick={() => onStatus(doctor)}>{doctor.status === 'inactive' ? 'Reativar médico' : 'Inativar médico'}</button></div>}
            </ContextMenu></td>
          </tr>)}
          {data.rows.length === 0 && <tr><td colSpan={3 + visibleColumns.length} className="p-8 text-center text-sm text-text-muted">{activeDirectoryFilters(query.filters).length ? 'Nenhum médico encontrado com os filtros aplicados.' : 'Nenhum médico cadastrado nesta empresa.'}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}
