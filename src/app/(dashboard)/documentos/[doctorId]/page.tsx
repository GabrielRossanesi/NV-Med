'use client';
/* eslint-disable @next/next/no-img-element */

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ArrowLeft, BriefcaseBusiness, Building2, CalendarClock, Download, ExternalLink, FileImage, FileText, FolderOpen, Grid2X2, History, List, LoaderCircle, ShieldCheck, Upload, X } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import { canEditPermission } from '@/lib/permissions';
import { documentStatusClasses, documentStatusLabels, documentStatusOrder, getDoctorCompliance } from '@/lib/documentCompliance';
import { applicableDocuments, getDocumentGovernance } from '@/lib/documentGovernance';
import { doctorContractModelLabels } from '@/lib/doctorProfile';
import { openDocument } from '@/services/supabaseService';
import { useStore } from '@/store/useStore';
import type { DoctorContractModel, DocumentStatus, DocumentType, MedicalDocument } from '@/types';

type FolderView = 'grid' | 'list';

export default function DoctorDocumentsPage({ params }: { params: Promise<{ doctorId: string }> }) {
  const { doctorId } = use(params);
  const store = useStore();
  const [referenceTime] = useState(() => Date.now());
  const [view, setView] = useState<FolderView>('grid');
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({});
  const [expiryDrafts, setExpiryDrafts] = useState<Record<string, string>>({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, DocumentStatus>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteEditors, setNoteEditors] = useState<Record<string, boolean>>({});
  const [previewDocument, setPreviewDocument] = useState<MedicalDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const doctor = store.doctors.find(item => item.id === doctorId && item.organizationId === store.activeOrganizationId);
  const activeOrganization = store.organizations.find(item => item.id === store.activeOrganizationId);
  const requirements = useMemo(() => activeOrganization?.settings.requiredDocuments || [], [activeOrganization]);
  const governance = getDocumentGovernance(activeOrganization);
  const organizationDocuments = useMemo(() => store.documents.filter(item => item.organizationId === store.activeOrganizationId), [store.documents, store.activeOrganizationId]);
  const doctorDocuments = useMemo(() => doctor ? applicableDocuments(doctor, organizationDocuments, requirements).sort((a, b) => documentStatusOrder[a.status] - documentStatusOrder[b.status] || a.name.localeCompare(b.name, 'pt-BR')) : [], [organizationDocuments, doctor, requirements]);
  const linkedUnits = store.units.filter(unit => unit.organizationId === store.activeOrganizationId && doctor?.linkedUnits.includes(unit.id));
  const summary = doctor ? getDoctorCompliance(doctor, organizationDocuments, referenceTime, requirements, Math.max(...governance.expiryAlertDays)) : null;
  const auditEntries = store.documentAudits.filter(entry => entry.organizationId === store.activeOrganizationId && entry.doctorId === doctorId);
  const canEdit = canEditPermission(store.currentUser, 'documentos');
  const canEditDoctor = canEditPermission(store.currentUser, 'medicos');

  if (!doctor || !summary) {
    return <AccessGuard requiredPermission="documentos"><div className="py-20 text-center"><AlertCircle className="mx-auto h-9 w-9 text-danger"/><h1 className="mt-4 text-lg font-semibold">Pasta não encontrada</h1><p className="mt-1 text-sm text-text-muted">O médico não pertence à empresa ativa ou foi removido.</p><Link href="/documentos" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><ArrowLeft size={15}/>Voltar para documentos</Link></div></AccessGuard>;
  }

  const preview = async (document: MedicalDocument) => {
    if (!document.filePath) return;
    setPreviewDocument(document);
    setPreviewUrl('');
    setPreviewError('');
    setPreviewLoading(true);
    try { setPreviewUrl(await openDocument(document.filePath)); }
    catch (error) { setPreviewError(error instanceof Error ? error.message : 'Não foi possível abrir o arquivo.'); }
    finally { setPreviewLoading(false); }
  };

  const upload = async (document: MedicalDocument) => {
    const file = selectedFiles[document.type];
    if (!file || !await store.uploadDocument(doctor.id, document.type as DocumentType, file)) return;
    setSelectedFiles(current => { const next = { ...current }; delete next[document.type]; return next; });
  };

  const saveExpiry = async (document: MedicalDocument) => {
    const expiryDate = expiryDrafts[document.id] ?? document.expiryDate ?? '';
    await store.updateDocument({ ...document, expiryDate: expiryDate || undefined });
  };

  const saveReview = async (document: MedicalDocument) => {
    const status = statusDrafts[document.id] || document.status;
    const reviewNote = (noteDrafts[document.id] ?? document.reviewNote ?? '').trim();
    if (status === 'rejected' && !reviewNote) return;
    await store.updateDocument({ ...document, status, reviewNote: reviewNote || undefined });
  };

  const isImage = previewDocument?.fileName ? /\.(png|jpe?g)$/i.test(previewDocument.fileName) : false;

  return (
    <AccessGuard requiredPermission="documentos">
      <div className="space-y-6 animate-in fade-in duration-300">
        <header>
          <Link href="/documentos" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-primary"><ArrowLeft size={14}/>Voltar para documentação</Link>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0"><div className="flex items-center gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-semibold ${summary.critical ? 'bg-danger/10 text-danger' : summary.pending ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>{doctor.name.split(' ').filter(Boolean).slice(0,2).map(part => part[0]).join('')}</span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Pasta documental</p><h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-text-primary">{doctor.name}</h1></div></div><p className="mt-3 text-sm text-text-muted">CRM {doctor.crm}-{doctor.crmUf}{doctor.rqe ? ` · RQE ${doctor.rqe}` : ''} · {doctor.specialty}</p></div>
            <div className="inline-flex self-start rounded-xl border border-border bg-card-bg p-1"><button type="button" onClick={() => setView('grid')} aria-label="Visualização em grade" className={`rounded-lg p-2.5 transition ${view === 'grid' ? 'bg-primary text-text-inverse' : 'text-text-muted hover:bg-state-hover'}`}><Grid2X2 size={16}/></button><button type="button" onClick={() => setView('list')} aria-label="Visualização em lista" className={`rounded-lg p-2.5 transition ${view === 'list' ? 'bg-primary text-text-inverse' : 'text-text-muted hover:bg-state-hover'}`}><List size={16}/></button></div>
          </div>
        </header>

        {(summary.critical > 0 || summary.nearExpiry > 0) && <section className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger/5 px-4 py-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger"/><div><h2 className="text-sm font-semibold text-text-primary">Atenção documental</h2><p className="mt-0.5 text-xs text-text-muted">{summary.critical > 0 ? `${summary.critical} documento(s) vencido(s), reprovado(s) ou ausente(s).` : ''}{summary.nearExpiry > 0 ? ` ${summary.nearExpiry} documento(s) vence(m) nos próximos ${Math.max(...governance.expiryAlertDays)} dias.` : ''}</p></div></section>}

        <section className="grid overflow-hidden rounded-2xl border border-border bg-card-bg sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.4fr]">
          <div className="p-5"><p className="text-xs text-text-muted">Conformidade</p><p className="mt-2 text-2xl font-semibold tabular-nums">{summary.percentage}%</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className={`h-full rounded-full ${summary.compliant ? 'bg-success' : summary.critical ? 'bg-danger' : 'bg-warning'}`} style={{width:`${summary.percentage}%`}}/></div></div>
          <div className="border-t border-border p-5 sm:border-l sm:border-t-0"><p className="text-xs text-text-muted">Aprovados</p><p className="mt-2 text-2xl font-semibold text-success">{summary.approved}<span className="text-sm font-normal text-text-muted">/{summary.total}</span></p></div>
          <div className="border-t border-border p-5 xl:border-l xl:border-t-0"><p className="text-xs text-text-muted">Pendentes</p><p className={`mt-2 text-2xl font-semibold ${summary.pending ? 'text-warning' : 'text-success'}`}>{summary.pending}</p></div>
          <div className="border-t border-border p-5 sm:border-l xl:border-t-0"><p className="text-xs text-text-muted">Unidades vinculadas</p><div className="mt-2 flex flex-wrap gap-1.5">{linkedUnits.map(unit => <span key={unit.id} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-[11px] font-medium text-text-secondary"><Building2 size={12}/>{unit.name}</span>)}{!linkedUnits.length && <span className="text-xs text-text-muted">Nenhuma unidade</span>}</div></div>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card-bg p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BriefcaseBusiness size={18}/></span><div><h2 className="text-sm font-semibold text-text-primary">Vínculo contratual</h2><p className="mt-1 text-xs text-text-muted">Classificação operacional e confirmação do contrato deste médico.</p></div></div>
          <div className="grid gap-3 sm:grid-cols-[210px_minmax(220px,1fr)] lg:min-w-[500px]">
            <label className="nv-label">Participação<select className="nv-input disabled:cursor-not-allowed disabled:opacity-65" disabled={!canEditDoctor || store.saving} value={doctor.contractModel || 'pf'} onChange={event => store.updateDoctor({...doctor, contractModel:event.target.value as DoctorContractModel})}>{Object.entries(doctorContractModelLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${doctor.contractSigned ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'} ${canEditDoctor ? 'cursor-pointer' : 'cursor-default opacity-75'}`}><input type="checkbox" disabled={!canEditDoctor || store.saving} checked={Boolean(doctor.contractSigned)} onChange={event => store.updateDoctor({...doctor, contractSigned:event.target.checked})} className="h-4 w-4 rounded border-border text-primary focus:ring-primary"/><span><span className="block text-xs font-semibold text-text-primary">Contrato assinado</span><span className={`mt-0.5 block text-[10px] ${doctor.contractSigned ? 'text-success' : 'text-warning'}`}>{doctor.contractSigned ? 'Formalização concluída' : 'Aguardando assinatura'}</span></span></label>
          </div>
        </section>

        {!canEdit && <p className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text-secondary"><ShieldCheck size={16} className="text-primary"/>Acesso somente para consulta. Arquivos, validade e situação não podem ser alterados.</p>}

        <section>
          <div className="mb-3 flex items-end justify-between"><div><h2 className="text-sm font-semibold text-text-primary">Arquivos obrigatórios</h2><p className="mt-1 text-xs text-text-muted">Clique em um arquivo enviado para abrir a pré-visualização.</p></div><span className="text-xs text-text-muted">{doctorDocuments.length} itens</span></div>
          <div className={view === 'grid' ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'overflow-hidden rounded-2xl border border-border bg-card-bg divide-y divide-border'}>
            {doctorDocuments.map(document => {
              const selected = selectedFiles[document.type];
              const expiryValue = expiryDrafts[document.id] ?? document.expiryDate ?? '';
              const reviewStatus = statusDrafts[document.id] || document.status;
              const reviewNote = noteDrafts[document.id] ?? document.reviewNote ?? '';
              const reviewChanged = reviewStatus !== document.status || reviewNote !== (document.reviewNote || '');
              const showNoteEditor = reviewStatus === 'rejected' || Boolean(document.reviewNote) || noteEditors[document.id];
              return <article key={document.id} className={`${view === 'grid' ? 'rounded-2xl border border-border bg-card-bg p-4 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-medium' : 'grid gap-4 p-4 md:grid-cols-[minmax(220px,1.3fr)_140px_190px_minmax(250px,1fr)] md:items-start'} group`}>
                <button type="button" disabled={!document.filePath} onClick={() => preview(document)} className={`flex w-full min-w-0 items-start gap-3 text-left ${document.filePath ? 'cursor-pointer' : 'cursor-default'}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${document.status === 'approved' ? 'bg-success/10 text-success' : document.status === 'expired' || document.status === 'rejected' ? 'bg-danger/10 text-danger' : 'bg-surface-muted text-text-muted'}`}>{document.fileName && /\.(png|jpe?g)$/i.test(document.fileName) ? <FileImage size={19}/> : <FileText size={19}/>}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-text-primary group-hover:text-primary">{document.name}</span><span className="mt-1 block truncate text-xs text-text-muted">{document.fileName || 'Arquivo não enviado'}</span>{document.uploadDate && <span className="mt-1 block text-[10px] text-text-muted">Enviado em {new Date(`${document.uploadDate}T12:00:00`).toLocaleDateString('pt-BR')} · versão {document.version || 1}</span>}</span></button>
                <div className={view === 'grid' ? 'mt-4 flex items-center justify-between border-t border-border pt-3' : ''}><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${documentStatusClasses[document.status]}`}>{documentStatusLabels[document.status]}</span>{view === 'grid' && document.filePath && <ExternalLink size={14} className="text-text-muted"/>}</div>
                <div className={view === 'grid' ? 'mt-3' : ''}><label className="nv-label">Validade<input type="date" className="nv-input disabled:opacity-60" disabled={!canEdit} value={expiryValue} onChange={event => setExpiryDrafts(current => ({...current,[document.id]:event.target.value}))}/></label>{canEdit && expiryValue !== (document.expiryDate || '') && <button type="button" disabled={store.saving} onClick={() => saveExpiry(document)} className="mt-2 text-xs font-semibold text-primary hover:underline">Salvar validade</button>}</div>
                {canEdit && <div className={`${view === 'grid' ? 'mt-3 border-t border-border pt-3' : ''} space-y-2`}><div className="flex flex-wrap items-center gap-2"><select aria-label={`Situação de ${document.name}`} className="rounded-lg border border-input-border bg-input-bg px-2.5 py-2 text-xs text-text-primary" value={reviewStatus} onChange={event => setStatusDrafts(current => ({...current,[document.id]:event.target.value as DocumentStatus}))}><option value="not_sent">Não enviado</option><option value="sent">Recebido</option><option value="analyzing">Em análise</option><option value="approved">Aprovado</option><option value="rejected">Reprovado</option><option value="expired">Vencido</option></select><label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card-bg px-2.5 py-2 text-xs font-semibold text-text-secondary transition hover:bg-state-hover"><Upload size={13}/>{selected ? 'Trocar arquivo' : document.filePath ? 'Substituir' : 'Selecionar'}<input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={event => { const file=event.target.files?.[0]; if(file) setSelectedFiles(current=>({...current,[document.type]:file})); }}/></label>{!showNoteEditor && <button type="button" className="text-xs font-semibold text-text-muted hover:text-primary" onClick={() => setNoteEditors(current => ({...current,[document.id]:true}))}>Adicionar observação</button>}{selected && <button type="button" disabled={store.saving} onClick={() => upload(document)} className="rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-text-inverse">Enviar</button>}</div>{showNoteEditor && <textarea aria-label={`Observação de ${document.name}`} className="nv-input min-h-16 text-xs" maxLength={1000} placeholder={reviewStatus === 'rejected' ? 'Informe o motivo da reprovação' : 'Observação da análise (opcional)'} value={reviewNote} onChange={event => setNoteDrafts(current => ({...current,[document.id]:event.target.value}))}/>} {reviewChanged && <button type="button" className="text-xs font-semibold text-primary hover:underline disabled:opacity-50" disabled={store.saving || (reviewStatus === 'rejected' && !reviewNote.trim())} onClick={() => saveReview(document)}>Salvar análise</button>}</div>}
              </article>;
            })}
            {!doctorDocuments.length && <div className="col-span-full rounded-2xl border border-dashed border-border py-16 text-center"><FolderOpen className="mx-auto h-7 w-7 text-text-muted"/><p className="mt-3 text-sm font-medium">Nenhum requisito documental configurado.</p></div>}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card-bg"><header className="flex items-center gap-2 border-b border-border px-4 py-3"><History size={16} className="text-primary"/><div><h2 className="text-sm font-semibold">Histórico e auditoria</h2><p className="mt-0.5 text-xs text-text-muted">Alterações de arquivo, situação, validade e observações.</p></div></header><div className="divide-y divide-border">{auditEntries.slice(0, 30).map(entry => { const document = doctorDocuments.find(item => item.id === entry.documentId); const previousFilePath = typeof entry.changes.previousFilePath === 'string' ? entry.changes.previousFilePath : ''; const actionLabels = { created: 'Requisito criado', file_uploaded: 'Arquivo enviado', file_replaced: 'Arquivo substituído', status_changed: 'Situação alterada', expiry_changed: 'Validade alterada', note_changed: 'Observação atualizada', updated: 'Documento atualizado' }; return <article key={entry.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-center"><div><p className="text-sm font-medium text-text-primary">{document?.name || 'Documento'}</p><p className="mt-0.5 text-xs text-text-muted">{actionLabels[entry.action]} por {entry.actorName}</p></div><div>{entry.fromStatus && entry.toStatus && entry.fromStatus !== entry.toStatus && <p className="text-xs text-text-secondary">{documentStatusLabels[entry.fromStatus]} → {documentStatusLabels[entry.toStatus]}</p>}{entry.note && <p className="mt-1 text-xs text-text-muted">“{entry.note}”</p>}{previousFilePath && document && <button type="button" className="mt-1 text-xs font-semibold text-primary hover:underline" onClick={() => preview({ ...document, filePath: previousFilePath, fileName: typeof entry.changes.previousFileName === 'string' ? entry.changes.previousFileName : 'Versão anterior' })}>Abrir versão anterior</button>}</div><time className="text-xs tabular-nums text-text-muted">{new Date(entry.createdAt).toLocaleString('pt-BR')}</time></article>; })}{!auditEntries.length && <p className="px-4 py-8 text-center text-sm text-text-muted">O histórico aparecerá após a primeira alteração realizada com a nova auditoria.</p>}</div></section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-text-muted"><span className="flex items-center gap-1.5"><CalendarClock size={14}/>Validades devem ser revisadas durante o credenciamento e antes da escala.</span><Link href={`/medicos/${doctor.id}`} className="font-semibold text-primary hover:underline">Abrir perfil completo do médico</Link></footer>
      </div>

      {previewDocument && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={`Visualização de ${previewDocument.name}`}><div className="flex h-[min(90vh,860px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card-bg shadow-2xl"><header className="flex items-center justify-between border-b border-border px-4 py-3"><div className="min-w-0"><h2 className="truncate text-sm font-semibold text-text-primary">{previewDocument.name}</h2><p className="mt-0.5 truncate text-xs text-text-muted">{previewDocument.fileName}</p></div><div className="flex items-center gap-1">{previewUrl && <><a href={previewUrl} download className="rounded-lg p-2 text-text-muted hover:bg-state-hover hover:text-primary" aria-label="Baixar arquivo"><Download size={17}/></a><a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-text-muted hover:bg-state-hover hover:text-primary" aria-label="Abrir em nova guia"><ExternalLink size={17}/></a></>}<button type="button" onClick={() => {setPreviewDocument(null);setPreviewUrl('');}} className="rounded-lg p-2 text-text-muted hover:bg-state-hover hover:text-text-primary" aria-label="Fechar visualização"><X size={18}/></button></div></header><div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="flex min-h-[380px] items-center justify-center overflow-auto bg-slate-950/95 p-4">{previewLoading ? <LoaderCircle className="h-7 w-7 animate-spin text-white/70"/> : previewError ? <p className="text-sm text-red-300">{previewError}</p> : previewUrl && (isImage ? <img src={previewUrl} alt={previewDocument.name} className="max-h-full max-w-full object-contain"/> : <iframe src={previewUrl} title={previewDocument.name} className="h-full min-h-[500px] w-full rounded-lg bg-white"/> )}</div><aside className="border-t border-border p-5 lg:border-l lg:border-t-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Detalhes do arquivo</p><dl className="mt-4 space-y-4 text-xs"><div><dt className="text-text-muted">Médico</dt><dd className="mt-1 font-medium text-text-primary">{doctor.name}</dd></div><div><dt className="text-text-muted">Situação</dt><dd className="mt-1"><span className={`inline-flex rounded-full border px-2.5 py-1 font-semibold ${documentStatusClasses[previewDocument.status]}`}>{documentStatusLabels[previewDocument.status]}</span></dd></div><div><dt className="text-text-muted">Envio</dt><dd className="mt-1 font-medium text-text-primary">{previewDocument.uploadDate ? new Date(`${previewDocument.uploadDate}T12:00:00`).toLocaleDateString('pt-BR') : 'Não informado'}</dd></div><div><dt className="text-text-muted">Validade</dt><dd className="mt-1 font-medium text-text-primary">{previewDocument.expiryDate ? new Date(`${previewDocument.expiryDate}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem validade definida'}</dd></div><div><dt className="text-text-muted">Unidades</dt><dd className="mt-1 leading-relaxed text-text-primary">{linkedUnits.map(unit => unit.name).join(' · ') || 'Nenhuma unidade vinculada'}</dd></div></dl></aside></div></div></div>}
    </AccessGuard>
  );
}
