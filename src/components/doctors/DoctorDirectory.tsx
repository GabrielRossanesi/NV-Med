'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, Plus, Settings2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { canPerformAction } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/client';
import { notify } from '@/lib/notifications';
import { activeDirectoryFilters, defaultDoctorListing, directoryBulkMessages, directoryExportError, directoryParams, emptyDirectoryFilters, parseDirectoryQuery,
  type DirectoryDoctor, type DirectoryFilter, type DirectoryQuery, type DoctorListingPreferences } from '@/lib/doctorDirectory';
import DoctorCreateDialog from '../DoctorCreateDialog';
import Dialog from '../Dialog';
import { useConfirmation } from '../ConfirmationProvider';
import DoctorDirectoryFilters from './DoctorDirectoryFilters';
import DoctorDirectoryTable from './DoctorDirectoryTable';
import { directoryError, useDoctorDirectory } from './useDoctorDirectory';
import DoctorListingPreferenceFields from './DoctorListingPreferenceFields';
import { downloadBlob } from '@/lib/csv';

type BulkResult = { id: string; result: string };
export default function DoctorDirectory({ organization }: { organization: string }) {
  const params = useSearchParams();
  const user = useStore(state => state.currentUser);
  const preferences = useStore(state => state.accountPreferences);
  const prefs = preferences.doctorListing || defaultDoctorListing;
  const savePreferences = useStore(state => state.saveAccountPreferences);
  const preferenceStatus = useStore(state => state.accountPreferencesStatus);
  const query = parseDirectoryQuery(new URLSearchParams(params?.get('company') && params.get('company') !== organization ? '' : params?.toString()), prefs);
  const { data, context, error, loading, refresh } = useDoctorDirectory(organization, query);
  const [selection, setSelection] = useState<{ key: string; rows: DirectoryDoctor[] }>({ key: '', rows: [] });
  const queryKey = JSON.stringify(query);
  const currentRevisions = new Map(data?.rows.map(doctor => [doctor.id, doctor.revision]) || []);
  const selected = selection.key === queryKey ? selection.rows.filter(doctor => currentRevisions.get(doctor.id) === doctor.revision) : [];
  const selectedIds = new Set(selected.map(doctor => doctor.id));
  const [create, setCreate] = useState(false);
  const [settings, setSettings] = useState<DoctorListingPreferences | null>(null);
  const [settingsDensity, setSettingsDensity] = useState(preferences.density);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportScope, setExportScope] = useState('filtered');
  const [exportFormat, setExportFormat] = useState('xlsx');
  const [results, setResults] = useState<{ results: BulkResult[]; names: Record<string, string> } | null>(null);
  const [clearKey, setClearKey] = useState(0);
  const confirm = useConfirmation();
  const canEdit = canPerformAction(user, 'medicos', 'edit');
  const canCreate = canPerformAction(user, 'medicos', 'create');
  const canDocuments = canPerformAction(user, 'documentos', 'view');
  const canPortal = canPerformAction(user, 'portal_medico', 'view');
  const canSchedule = canPerformAction(user, 'escala', 'view');
  function update(change: (current: DirectoryQuery) => DirectoryQuery) {
    const urlParams = new URLSearchParams(window.location.search);
    const current = parseDirectoryQuery(urlParams.get('company') && urlParams.get('company') !== organization ? new URLSearchParams() : urlParams, prefs);
    const next = change(current);
    setSelection({ key: '', rows: [] });
    window.history.replaceState(null, '', `/medicos?${directoryParams(next, organization)}`);
  }
  function clear() {
    setClearKey(value => value + 1);
    update(current => ({ ...current, page: 1, filters: { ...emptyDirectoryFilters } }));
  }
  function filter(key: DirectoryFilter, value: string) { update(current => ({ ...current, page: 1, filters: { ...current.filters, [key]: value } })); }
  async function bulk(rows: DirectoryDoctor[], operation: 'status' | 'request_documents', status?: string) {
    if (busy) return;
    setBusy(true);
    const requestId = crypto.randomUUID();
    let report: { results: BulkResult[]; names: Record<string, string> } | null = null;
    try { await confirm({ title: operation === 'status' ? status === 'inactive' ? 'Inativar médicos?' : status === 'active' ? 'Ativar médicos?' : 'Alterar para pendente?' : 'Solicitar documentos pendentes?',
      description: operation === 'status'
        ? `${rows.length} ${rows.length === 1 ? 'médico selecionado' : 'médicos selecionados'}. Plantões, pagamentos e documentos serão preservados. Pela regra atual, cadastro inativo restringe o uso do portal; credenciais não serão revogadas. A ativação não libera acesso.`
        : `${rows.length} ${rows.length === 1 ? 'médico selecionado' : 'médicos selecionados'}. A solicitação será enviada como notificação interna somente às contas disponíveis no portal. Nenhum convite ou e-mail será enviado.`,
      tone: status === 'inactive' ? 'danger' : 'success', confirmLabel: operation === 'status' ? 'Confirmar alteração' : 'Solicitar documentos',
      onConfirm: async () => {
        const finish = notify.saving();
        try {
          const response = await createClient()?.rpc('nv_doctor_directory_bulk', { org: organization, request_id: requestId, operation,
            targets: rows.map(doctor => ({ id: doctor.id, revision: doctor.revision })), new_status: status || null });
          if (!response || response.error) { notify.error('Não foi possível concluir a operação.', { description: directoryError(response?.error?.code) }); return false; }
          const completed = response.data as BulkResult[];
          const success = completed.filter(item => item.result === 'success').length;
          report = { results: completed, names: Object.fromEntries(rows.map(doctor => [doctor.id, doctor.name])) };
          setSelection({ key: '', rows: [] }); refresh();
          if (success === rows.length) notify.success('Operação concluída.', { description: operation === 'request_documents'
            ? `${success} ${success === 1 ? 'notificação enviada' : 'notificações enviadas'} no Portal Médico.`
            : `${success} ${success === 1 ? 'médico no status solicitado' : 'médicos no status solicitado'}.` });
          else notify.warning('Operação concluída com pendências.', { description: `${success} de ${rows.length} concluídos. Confira o resultado por profissional.` });
          return true;
        } catch { notify.error('Não foi possível concluir a operação.', { description: 'Tente novamente. A mesma solicitação será reutilizada para evitar duplicações.' }); return false; }
        finally { finish(); }
      },
    });
    if (report) setResults(report);
    } finally { setBusy(false); }
  }
  async function exportDoctors() {
    if (busy) return;
    let failureMessage = directoryExportError();
    setBusy(true); const finish = notify.saving();
    try {
      const response = await fetch('/api/reports/doctors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org: organization,
        filters: exportScope === 'all' || exportScope === 'selected' ? {} : query.filters, ids: exportScope === 'selected' ? selected.map(doctor => doctor.id) : null,
        requestId: crypto.randomUUID(), format: exportFormat }) });
      if (!response.ok) { failureMessage = directoryExportError(response.status); throw new Error(); }
      downloadBlob(`nvmed-medicos.${exportFormat}`, await response.blob());
      setExporting(false); notify.success('Exportação preparada.');
    } catch { notify.error('Não foi possível exportar.', { description: failureMessage }); }
    finally { finish(); setBusy(false); }
  }
  const metrics = context?.indicators;
  const indicators: { label: string; count: number | undefined; key?: DirectoryFilter; value?: string }[] = [
    { label: 'Total de médicos', count: metrics?.total }, { label: 'Ativos', count: metrics?.active, key: 'status', value: 'active' },
    { label: 'Pendentes', count: metrics?.pending, key: 'status', value: 'pending' }, { label: 'Com RQE', count: metrics?.with_rqe, key: 'rqe', value: 'with' },
    { label: 'Sem RQE', count: metrics?.without_rqe, key: 'rqe', value: 'without' },
    ...(context?.permissions.documents ? [{ label: 'Pendências documentais', count: metrics?.documents, key: 'documents' as DirectoryFilter, value: 'pending' }] : []),
  ];
  const returnTo = `/medicos?${directoryParams(query, organization)}`;
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="nv-page-title">Médicos</h2><div className="flex flex-wrap gap-2">
      {context?.permissions.export && <button className="nv-button-secondary" disabled={busy || loading} onClick={() => { setExportScope(selected.length ? 'selected' : 'filtered'); setExporting(true); }}><Download className="size-4"/>Exportar</button>}
      {canCreate && <button className="nv-button" disabled={busy} onClick={() => setCreate(true)}><Plus className="size-4"/>Novo médico</button>}
    </div></header>
    <nav aria-label="Indicadores do corpo clínico" className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-border py-3 sm:grid-cols-3 xl:flex xl:justify-between">
      {indicators.map(indicator => {
        const pressed = indicator.key ? query.filters[indicator.key] === indicator.value : activeDirectoryFilters(query.filters).length === 0;
        return <button key={indicator.label} aria-pressed={pressed} type="button" disabled={!context || busy}
          className={`min-h-14 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${pressed ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-state-hover'}`}
          onClick={() => {
            const filters = { ...emptyDirectoryFilters };
            if (indicator.key && indicator.value) filters[indicator.key] = indicator.value;
            setClearKey(value => value + 1);
            update(current => ({ ...current, page: 1, filters }));
          }}>
          <span className="block text-xl font-semibold tabular-nums">{indicator.count ?? '—'}</span><span className="block text-xs">{indicator.label}</span>
        </button>;
      })}
    </nav>
    <DoctorDirectoryFilters key={clearKey} filters={query.filters} data={context} onChange={filter} onSearch={value => filter('q', value)} onClear={clear} disabled={busy}/>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p aria-live="polite" className="text-text-secondary">{loading ? 'Carregando médicos…' : data ? `${data.total} ${data.total === 1 ? 'médico encontrado' : 'médicos encontrados'}` : 'Listagem indisponível'}</p>
      <button className="nv-button-secondary" disabled={busy || preferenceStatus !== 'ready'} onClick={() => { setSettingsDensity(preferences.density); setSettings({ ...prefs, columns: [...prefs.columns] }); }}><Settings2 className="size-4"/>Preferências</button>
    </div>
    {selected.length > 0 && <section aria-label="Ações em massa" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-muted p-3 text-sm">
      <p className="font-medium">{selected.length} {selected.length === 1 ? 'selecionado' : 'selecionados'} nesta página</p>
      <button className="nv-button-secondary" disabled={busy} onClick={() => setSelection({ key: '', rows: [] })}>Limpar seleção</button>
      {context?.permissions.export && <button className="nv-button-secondary" disabled={busy} onClick={() => { setExportScope('selected'); setExporting(true); }}>Exportar selecionados</button>}
      {context?.permissions.requestDocuments && <button className="nv-button-secondary" disabled={busy} onClick={() => void bulk(selected, 'request_documents')}>Solicitar documentos pendentes</button>}
      {canEdit && <label className="sr-only" htmlFor="bulk-doctor-status">Alterar status dos selecionados</label>}
      {canEdit && <select id="bulk-doctor-status" className="nv-input w-full sm:w-auto" disabled={busy} value="" onChange={event => { if (event.target.value) void bulk(selected, 'status', event.target.value); }}>
        <option value="">Alterar status cadastral</option><option value="active">Ativar</option><option value="pending">Alterar para pendente</option><option value="inactive">Inativar</option>
      </select>}
    </section>}
    {error && <div role="alert" className="nv-panel space-y-3 p-5"><p className="text-sm text-danger">{error}</p><button className="nv-button-secondary" onClick={refresh}>Tentar novamente</button></div>}
    {loading && <div role="status" aria-label="Carregando listagem" className="space-y-4 rounded-xl border border-card-border p-5 motion-safe:animate-pulse">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-10 rounded-lg bg-surface-muted"/>)}</div>}
    {data && <>
      <DoctorDirectoryTable data={data} query={query} columns={prefs.columns} compact={preferences.density === 'compact'} selected={selectedIds} returnTo={returnTo}
        canEdit={canEdit && data.permissions.edit} canDocuments={canDocuments && data.permissions.documents} canPortal={canPortal && data.permissions.portal} canSchedule={canSchedule && data.permissions.schedule}
        onSelect={doctor => setSelection({ key: queryKey, rows: selectedIds.has(doctor.id) ? selected.filter(item => item.id !== doctor.id) : [...selected, doctor] })}
        onSelectPage={() => setSelection({ key: queryKey, rows: selected.length === data.rows.length ? [] : data.rows })}
        onSort={sort => update(current => ({ ...current, page: 1, sort, descending: current.sort === sort ? !current.descending : false }))}
        onStatus={doctor => void bulk([doctor], 'status', doctor.status === 'inactive' ? 'active' : 'inactive')}/>
      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
        <p>Exibindo {data.total ? (data.page - 1) * data.pageSize + 1 : 0}–{Math.min(data.page * data.pageSize, data.total)} de {data.total} médicos</p>
        <div className="flex flex-wrap items-center gap-2"><label htmlFor="doctor-page-size">Por página</label><select id="doctor-page-size" className="nv-input w-auto" value={query.pageSize} onChange={event => update(current => ({ ...current, page: 1, pageSize: Number(event.target.value) as 25 | 50 | 100 }))}>
          {[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select>
          <button className="nv-button-secondary" aria-label="Página anterior" disabled={data.page <= 1 || busy} onClick={() => update(current => ({ ...current, page: data.page - 1 }))}><ChevronLeft className="size-4"/></button>
          <span>Página {data.page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
          <button className="nv-button-secondary" aria-label="Próxima página" disabled={data.page * data.pageSize >= data.total || busy} onClick={() => update(current => ({ ...current, page: data.page + 1 }))}><ChevronRight className="size-4"/></button>
        </div>
      </footer>
    </>}
    {create && <DoctorCreateDialog onClose={() => setCreate(false)} onCreated={() => { setSelection({ key: '', rows: [] }); refresh(); }}/>}
    {results && <Dialog title="Resultado da operação" onClose={() => setResults(null)} footer={<button className="nv-button" onClick={() => setResults(null)}>Fechar</button>}><ul className="space-y-3 text-sm">{results.results.map(item => <li key={item.id}><span className="block font-medium">{results.names[item.id] || item.id}</span><span className={item.result === 'success' ? 'text-success' : 'text-text-muted'}>{directoryBulkMessages[item.result] || directoryBulkMessages.failed}</span></li>)}</ul></Dialog>}
    {exporting && <Dialog title="Exportar médicos" size="sm" onClose={() => setExporting(false)} closeDisabled={busy} footer={<div className="flex justify-end gap-2"><button className="nv-button-secondary" disabled={busy} onClick={() => setExporting(false)}>Cancelar</button><button className="nv-button" disabled={busy || (exportScope === 'selected' && !selected.length)} onClick={() => void exportDoctors()}>{busy ? 'Preparando…' : 'Exportar arquivo'}</button></div>}>
      <div className="space-y-4"><label className="nv-label">Médicos a exportar<select aria-label="Médicos a exportar" className="nv-input" disabled={busy} value={exportScope} onChange={event => setExportScope(event.target.value)}><option value="all">Todos os médicos da empresa</option><option value="filtered">Resultados dos filtros aplicados</option><option value="selected" disabled={!selected.length}>Selecionados nesta página ({selected.length})</option></select></label>
        <label className="nv-label">Formato<select aria-label="Formato" className="nv-input" disabled={busy} value={exportFormat} onChange={event => setExportFormat(event.target.value)}><option value="xlsx">Excel (XLSX)</option><option value="csv">CSV</option></select></label>
        <p className="text-sm text-text-muted">Somente dados profissionais. A exportação exige MFA e será registrada na auditoria.</p></div>
    </Dialog>}
    {settings && <Dialog title="Preferências da listagem" size="sm" onClose={() => setSettings(null)} closeDisabled={busy} footer={<div className="flex flex-wrap justify-end gap-2"><button className="nv-button-secondary" disabled={busy} onClick={() => { setSettings({ ...defaultDoctorListing }); setSettingsDensity('comfortable'); }}>Restaurar padrão</button><button className="nv-button-secondary" disabled={busy} onClick={() => setSettings(null)}>Cancelar</button><button className="nv-button" disabled={busy} onClick={async () => {
      setBusy(true); try { if (await savePreferences({ density: settingsDensity, doctorListing: settings })) { update(current => ({ ...current, page: 1, pageSize: settings.pageSize, sort: settings.sort, descending: settings.descending })); setSettings(null); } } finally { setBusy(false); }
    }}>Salvar preferências</button></div>}>
      <div className="space-y-4"><DoctorListingPreferenceFields value={settings} onChange={setSettings} disabled={busy} documents={canDocuments} schedule={canSchedule}/>
        <label className="nv-label">Densidade da tabela<select aria-label="Densidade da tabela" className="nv-input" value={settingsDensity} disabled={busy} onChange={event => setSettingsDensity(event.target.value as 'compact' | 'comfortable')}><option value="comfortable">Confortável</option><option value="compact">Compacta</option></select></label>
      </div>
    </Dialog>}
  </div>;
}
