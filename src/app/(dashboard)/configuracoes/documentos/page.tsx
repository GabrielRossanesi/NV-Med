'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Building2, ChevronDown, FilePlus2, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import Dialog from '@/components/Dialog';
import { useStore } from '@/store/useStore';
import { canEditPermission } from '@/lib/permissions';
import { getDocumentGovernance, requirementApplies } from '@/lib/documentGovernance';
import { crmStates, documentTypeFromName, starterDocumentRequirements, validateDocumentRequirement } from '@/lib/documentRequirements';
import type { DocumentRequirement, Organization } from '@/types';

function RequirementsWorkspace({ organization }: { organization: Organization }) {
  const store = useStore();
  const reduceMotion = useReducedMotion();
  const requirements = organization.settings.requiredDocuments;
  const units = store.units.filter(unit => unit.organizationId === organization.id);
  const doctors = store.doctors.filter(doctor => doctor.organizationId === organization.id);
  const canManage = store.currentUser.type === 'tenant_user' && canEditPermission(store.currentUser, 'configuracoes');
  const [form, setFormValue] = useState<DocumentRequirement | null>(null);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<DocumentRequirement | null>(null);
  const [unitFilter, setUnitFilter] = useState('');
  const [governance, setGovernance] = useState(() => getDocumentGovernance(organization));
  const [policyOpen, setPolicyOpen] = useState(false);
  const [saved, setSaved] = useState('');
  const filtered = requirements.filter(item => !unitFilter || !item.unitIds?.length || item.unitIds.includes(unitFilter));
  const disabled = !canManage || store.saving;
  const starterAdditions = starterDocumentRequirements.filter(item => !requirements.some(current =>
    current.type === item.type || current.name.localeCompare(item.name, 'pt-BR', { sensitivity: 'base' }) === 0));
  const scopedForm = form ? { ...form, unitIds: scope === 'all' ? [] : form.unitIds } : null;
  const affectedDoctors = scopedForm && (scope === 'all' || scopedForm.unitIds?.length) ? doctors.filter(doctor => requirementApplies(scopedForm, doctor)).length : 0;

  function setForm(value: DocumentRequirement | null) {
    setError('');
    setFormValue(value);
  }

  function openForm(requirement?: DocumentRequirement) {
    setError('');
    setScope(requirement?.unitIds?.length ? 'selected' : 'all');
    setForm(requirement ? { ...requirement } : { type: '', name: '', required: true, blocking: true, expiryRequired: false, unitIds: [], specialties: [] });
  }
  async function persist(next: DocumentRequirement[], message: string) {
    const latest = useStore.getState().organizations.find(item => item.id === organization.id);
    if (!latest || !canManage) return false;
    const ok = await store.updateOrganizationSettings(organization.id, { settings: { ...latest.settings, requiredDocuments: next } });
    if (ok) setSaved(message);
    return ok;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!scopedForm || disabled) return;
    const next = { ...scopedForm, name: scopedForm.name.trim(), type: scopedForm.type || documentTypeFromName(scopedForm.name, requirements) };
    const validation = validateDocumentRequirement(next, requirements, units, scope);
    if (validation) return setError(validation);
    const updated = form?.type ? requirements.map(item => item.type === next.type ? next : item) : [...requirements, next];
    if (await persist(updated, 'Exigência salva. O checklist dos médicos foi atualizado.')) setForm(null);
    else setError(useStore.getState().error || 'Não foi possível salvar a exigência.');
  }
  async function savePolicy() {
    const latest = useStore.getState().organizations.find(item => item.id === organization.id);
    if (!latest || disabled) return;
    if (await store.updateOrganizationSettings(organization.id, { settings: { ...latest.settings, documentGovernance: governance } })) setSaved('Política de documentação salva.');
  }

  return <div className="space-y-6">
    <header>
      <Link href="/configuracoes" className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-text-muted transition hover:text-primary"><ArrowLeft size={14} />Perfil da empresa</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-semibold text-primary">{organization.name}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Documentos obrigatórios</h1><p className="mt-2 max-w-2xl text-sm text-text-muted">Defina o que cada médico deve apresentar e em quais unidades a exigência se aplica.</p></div>
        {canManage && <button type="button" onClick={() => openForm()} disabled={store.saving} className="nv-button"><Plus size={16} />Nova exigência</button>}
      </div>
    </header>
    {!canManage && <p className="border-l-2 border-primary pl-3 text-sm text-text-muted">Somente leitura. A pessoa responsável precisa de permissão de edição em Configurações para gerenciar exigências.</p>}
    {canManage && starterAdditions.length > 0 && <button type="button" className="nv-button-secondary" disabled={disabled} onClick={() => {
      if (window.confirm('Adicionar os itens ausentes do checklist inicial? As exigências atuais serão preservadas.')) {
        void persist([...requirements, ...starterAdditions], 'Checklist inicial adicionado.');
      }
    }}><FilePlus2 size={16}/>Adicionar checklist inicial</button>}
    {saved && <p role="status" className="text-sm text-success">{saved}</p>}
    <section aria-label="Exigências da empresa">
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <p className="text-sm text-text-secondary"><strong className="text-text-primary">{filtered.length}</strong> {filtered.length === 1 ? 'exigência' : 'exigências'}<span className="ml-3 text-xs text-text-muted">Regras gerais e da unidade se somam</span></p>
        <label className="flex items-center gap-2 text-xs text-text-muted">Abrangência<select className="nv-input w-auto max-w-64" value={unitFilter} onChange={event => setUnitFilter(event.target.value)}><option value="">Toda a empresa</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
      </div>
      {!filtered.length ? <div className="py-14 text-center"><FilePlus2 size={28} className="mx-auto text-primary" /><h2 className="mt-4 text-base font-semibold">{requirements.length ? 'Nenhuma exigência nesta unidade' : 'Monte o checklist da empresa'}</h2><p className="mx-auto mt-2 max-w-md text-sm text-text-muted">Cadastre documentos para todos os médicos ou restrinja a exigência às unidades e especialidades do contrato.</p>{canManage && <button type="button" className="nv-button-secondary mt-5" onClick={() => openForm()}>Adicionar documento</button>}</div> : <div className="divide-y divide-border">
        {filtered.map(requirement => <div key={requirement.type} className="flex flex-col gap-3 py-5 transition-colors hover:bg-state-hover/40 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{requirement.name}</h2><span className={`text-[11px] ${requirement.required ? 'text-primary' : 'text-text-muted'}`}>{requirement.required ? 'Obrigatório' : 'Opcional'}</span></div>
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-secondary"><Building2 size={13} className="mt-0.5 shrink-0" />{requirement.unitIds?.length ? requirement.unitIds.map(id => units.find(unit => unit.id === id)?.name || 'Unidade indisponível').join(', ') : 'Todas as unidades · inclui novas unidades'}</p>
            <p className="mt-1.5 text-xs text-text-muted">{requirement.specialties?.length ? requirement.specialties.join(', ') : 'Todas as especialidades'}{requirement.states?.length ? ' · CRM ' + requirement.states.join(', ') : ''}{requirement.annualRenewal ? ' · renovação anual' : requirement.expiryRequired ? ' · exige validade' : ''}{requirement.blocking !== false && requirement.required ? ' · pendência sujeita ao bloqueio de escala' : ''}</p>
          </div>
          {canManage && <div className="flex shrink-0 gap-1"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={() => openForm(requirement)} aria-label={`Editar ${requirement.name}`}><Pencil size={14} />Editar</button><button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted transition hover:bg-danger/5 hover:text-danger" disabled={store.saving} onClick={() => setRemoving(requirement)} aria-label={`Remover exigência ${requirement.name}`}><Trash2 size={16} /></button></div>}
        </div>)}
      </div>}
    </section>
    <section className="border-t border-border pt-5">
      <button type="button" onClick={() => setPolicyOpen(!policyOpen)} aria-expanded={policyOpen} aria-controls="document-policy" className="flex min-h-11 w-full items-center justify-between gap-3 text-left"><span><span className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-primary" />Alertas e bloqueio de escala</span><span className="mt-1 block text-xs text-text-muted">{getDocumentGovernance(organization).blockSchedulingOnCritical ? 'Bloqueio de pendências críticas ativado' : 'Bloqueio de pendências críticas desativado'}</span></span><ChevronDown size={16} className={`transition-transform ${policyOpen ? 'rotate-180' : ''}`} /></button>
      <AnimatePresence initial={false}>{policyOpen && <motion.div id="document-policy" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className="overflow-hidden"><div className="space-y-4 py-5">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" disabled={disabled} checked={governance.blockSchedulingOnCritical} onChange={event => setGovernance({ ...governance, blockSchedulingOnCritical: event.target.checked })} /><span>Bloquear novos plantões com pendências críticas<span className="mt-1 block text-xs text-text-muted">Aplica-se aos documentos obrigatórios marcados para bloqueio, quando ausentes, vencidos ou reprovados.</span></span></label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" disabled={disabled} checked={governance.internalNotifications} onChange={event => setGovernance({ ...governance, internalNotifications: event.target.checked })} />Ativar notificações internas de documentos</label>
        <fieldset><legend className="text-xs font-medium text-text-muted">Alertar antes do vencimento</legend><div className="mt-2 flex flex-wrap gap-2">{[90, 60, 30, 7].map(day => <button type="button" key={day} disabled={disabled} aria-pressed={governance.expiryAlertDays.includes(day)} onClick={() => setGovernance({ ...governance, expiryAlertDays: governance.expiryAlertDays.includes(day) ? governance.expiryAlertDays.filter(value => value !== day) : [...governance.expiryAlertDays, day] })} className={`min-h-10 rounded-lg border px-3 text-xs font-medium transition ${governance.expiryAlertDays.includes(day) ? 'border-primary bg-primary/5 text-primary' : 'border-border text-text-muted'}`}>{day} dias</button>)}</div></fieldset>
        {canManage && <button type="button" className="nv-button-secondary" disabled={store.saving || !governance.expiryAlertDays.length} onClick={() => void savePolicy()}>Salvar política</button>}
      </div></motion.div>}</AnimatePresence>
    </section>
    {form && <Dialog title={form.type ? 'Editar exigência' : 'Nova exigência'} onClose={() => !store.saving && setForm(null)}><form onSubmit={submit} className="space-y-5">
      <fieldset disabled={disabled} className="space-y-5 disabled:opacity-60">
        <label className="nv-label">Nome do documento<input autoFocus className="nv-input" required minLength={3} maxLength={120} placeholder="Ex.: Carteira do CRM, RQE ou ACLS" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <fieldset><legend className="nv-label">Onde exigir este documento?</legend><div className="mt-2 space-y-2"><label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${scope === 'all' ? 'border-primary bg-primary/5' : 'border-border'}`}><input type="radio" name="document-scope" value="all" checked={scope === 'all'} onChange={() => setScope('all')} className="mt-1" /><span className="text-sm font-medium">Todas as unidades da empresa<span className="mt-1 block text-xs font-normal text-text-muted">Inclui as unidades que forem cadastradas depois.</span></span></label><label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${scope === 'selected' ? 'border-primary bg-primary/5' : 'border-border'}`}><input type="radio" name="document-scope" value="selected" checked={scope === 'selected'} onChange={() => setScope('selected')} className="mt-1" /><span className="text-sm font-medium">Unidades específicas<span className="mt-1 block text-xs font-normal text-text-muted">Use para exigências de um contrato ou unidade.</span></span></label></div>
          {scope === 'selected' && <div className="mt-3 max-h-48 space-y-1 overflow-y-auto border-l-2 border-primary/30 pl-3">{units.map(unit => <label key={unit.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={form.unitIds?.includes(unit.id) || false} onChange={event => setForm({ ...form, unitIds: event.target.checked ? [...(form.unitIds || []), unit.id] : form.unitIds?.filter(id => id !== unit.id) })} />{unit.name}{unit.status === 'inactive' && <span className="text-xs text-text-muted">Inativa</span>}</label>)}{!units.length && <p className="py-2 text-xs text-text-muted">Cadastre uma unidade antes de criar uma exigência específica.</p>}</div>}
        </fieldset>
        <details><summary className="cursor-pointer text-sm font-medium">Especialidades <span className="font-normal text-text-muted">· {form.specialties?.length ? `${form.specialties.length} selecionadas` : 'todas'}</span></summary><p className="mt-2 text-xs text-text-muted">Sem seleção, a exigência vale para todas as especialidades.</p><div className="mt-2 space-y-1">{organization.settings.specialties.map(specialty => <label key={specialty} className="flex min-h-9 items-center gap-2 text-xs"><input type="checkbox" checked={form.specialties?.includes(specialty) || false} onChange={event => setForm({ ...form, specialties: event.target.checked ? [...(form.specialties || []), specialty] : form.specialties?.filter(item => item !== specialty) })} />{specialty}</label>)}</div></details>
        <div className="space-y-3 border-t border-border pt-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.required} onChange={event => setForm({ ...form, required: event.target.checked })} />Documento obrigatório</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.blocking !== false} onChange={event => setForm({ ...form, blocking: event.target.checked })} />Pendência sujeita ao bloqueio de escala</label><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(form.expiryRequired)} onChange={event => setForm({ ...form, expiryRequired: event.target.checked })} />Exigir data de validade</label></div>
        <details><summary className="cursor-pointer text-sm font-medium">UF do CRM</summary>
          <p className="mt-1 text-xs text-text-muted">Sem seleção, vale para todas as UFs.</p>
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">{crmStates.map(uf => <label key={uf} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.states?.includes(uf) || false} onChange={event =>
              setForm({ ...form, states: event.target.checked ? [...(form.states || []), uf] : form.states?.filter(value => value !== uf) })}/>{uf}
          </label>)}</div>
        </details>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(form.annualRenewal)} onChange={event =>
          setForm({ ...form, annualRenewal: event.target.checked, expiryRequired: event.target.checked || form.expiryRequired })}/>Renovação anual</label>
      </fieldset>
      <p className="border-t border-border pt-3 text-xs text-text-muted">{affectedDoctors} {affectedDoctors === 1 ? 'médico cadastrado alcançado' : 'médicos cadastrados alcançados'} pela regra. Novos médicos que atenderem à abrangência também receberão a exigência.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={store.saving} onClick={() => setForm(null)} className="nv-button-secondary">Cancelar</button><button type="submit" disabled={disabled} className="nv-button">{store.saving ? 'Salvando…' : 'Salvar exigência'}</button></div>
    </form></Dialog>}
    {removing && <Dialog title="Remover exigência" onClose={() => !store.saving && setRemoving(null)}><p className="text-sm text-text-secondary">O documento <strong>{removing.name}</strong> deixará de ser exigido. Os arquivos enviados e o histórico de análise serão preservados.</p><div className="mt-5 flex justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={() => setRemoving(null)}>Cancelar</button><button type="button" className="nv-button" disabled={disabled} onClick={async () => { if (await persist(requirements.filter(item => item.type !== removing.type), 'Exigência removida. Arquivos e histórico preservados.')) setRemoving(null); }}>{store.saving ? 'Removendo…' : 'Remover exigência'}</button></div></Dialog>}
  </div>;
}

export default function CompanyDocumentsPage() {
  const store = useStore();
  const organization = store.organizations.find(item => item.id === store.activeOrganizationId);
  return <AccessGuard requiredPermission="configuracoes">{organization ? <RequirementsWorkspace key={organization.id} organization={organization} /> : <p className="text-sm text-text-muted">Selecione uma empresa para configurar a documentação.</p>}</AccessGuard>;
}
