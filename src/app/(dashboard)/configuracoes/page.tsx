'use client';

import { useStore } from '@/store/useStore';
import { DocumentRequirement, Organization, Unit } from '@/types';
import AccessGuard from '@/components/AccessGuard';
import {
  Building,
  ShieldCheck,
  CheckCircle,
  Plus,
  Briefcase,
  Sun,
  BellRing,
  CalendarClock,
  LockKeyhole,
  FilePlus2,
  Trash2,
  Info
} from 'lucide-react';
import { useState } from 'react';
import { getDocumentGovernance } from '@/lib/documentGovernance';
import { canEditPermission } from '@/lib/permissions';

const DOCUMENT_NAME_SUGGESTIONS = [
  'Carteira do CRM',
  'Certidão Ética do CRM',
  'Certidão Financeira do CRM',
  'RQE',
  'Diploma de Residência ou Especialização',
  'Comprovante de Endereço',
  'Certificado ACLS',
  'Certificado PALS',
  'Certificado ATLS',
  'Contrato Social / CNPJ',
  'Certidões Fiscais',
  'Dados Bancários',
];

function documentTypeFromName(name: string, requirements: DocumentRequirement[]) {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'documento';
  const base = `custom_${normalized}`;
  let type = base;
  let suffix = 2;
  while (requirements.some(requirement => requirement.type === type)) {
    type = `${base.slice(0, 96 - String(suffix).length)}_${suffix}`;
    suffix += 1;
  }
  return type;
}

interface SettingsFormProps {
  activeOrg: Organization;
  activeOrganizationId: string;
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>) => Promise<boolean>;
  units: Unit[];
  canManageSettings: boolean;
  saving: boolean;
}

function SettingsForm({
  activeOrg,
  activeOrganizationId,
  updateOrganizationSettings,
  units,
  canManageSettings,
  saving,
}: SettingsFormProps) {
  const { theme, setTheme } = useStore();

  // Form editing state
  const [name, setName] = useState(activeOrg?.name || '');
  const [cnpj, setCnpj] = useState(activeOrg?.cnpj || '');
  const [phone, setPhone] = useState(activeOrg?.phone || '');
  const [email, setEmail] = useState(activeOrg?.email || '');
  const [address, setAddress] = useState(activeOrg?.address || '');
  const [newSpec, setNewSpec] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [documentGovernance, setDocumentGovernance] = useState(() => getDocumentGovernance(activeOrg));
  const [documentRequirements, setDocumentRequirements] = useState<DocumentRequirement[]>(() => activeOrg.settings.requiredDocuments);
  const [newDocumentName, setNewDocumentName] = useState('');
  const [newDocumentExpiryRequired, setNewDocumentExpiryRequired] = useState(false);
  const [newDocumentBlocking, setNewDocumentBlocking] = useState(true);
  const [documentFormError, setDocumentFormError] = useState('');

  const handleSaveOrgInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSettings) return;
    if (!await updateOrganizationSettings(activeOrganizationId, {
      name,
      cnpj,
      phone,
      email,
      address
    })) return;
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleAddSpecialty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSettings) return;
    if (!newSpec.trim()) return;

    if (activeOrg.settings.specialties.includes(newSpec.trim())) {
      alert('Esta especialidade já está cadastrada.');
      return;
    }

    const updatedSpecs = [...activeOrg.settings.specialties, newSpec.trim()];
    if (!await updateOrganizationSettings(activeOrganizationId, {
      settings: {
        ...activeOrg.settings,
        specialties: updatedSpecs
      }
    })) return;
    setNewSpec('');
  };

  const handleRemoveSpecialty = async (spec: string) => {
    if (!canManageSettings) return;
    const updatedSpecs = activeOrg.settings.specialties.filter((s) => s !== spec);
    if (!await updateOrganizationSettings(activeOrganizationId, {
      settings: {
        ...activeOrg.settings,
        specialties: updatedSpecs
      }
    })) return;
  };

  const updateRequirement = (type: string, updates: Partial<DocumentRequirement>) => {
    setDocumentRequirements(current => current.map(requirement => requirement.type === type ? { ...requirement, ...updates } : requirement));
  };

  const toggleScopeValue = (type: string, field: 'specialties' | 'unitIds', value: string) => {
    const requirement = documentRequirements.find(item => item.type === type);
    const current = requirement?.[field] || [];
    updateRequirement(type, { [field]: current.includes(value) ? current.filter(item => item !== value) : [...current, value] });
  };

  const saveDocumentGovernance = async () => {
    if (!canManageSettings) return;
    if (!await updateOrganizationSettings(activeOrganizationId, {
      settings: {
        ...activeOrg.settings,
        requiredDocuments: documentRequirements,
        documentGovernance,
      },
    })) return;
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const addDocumentRequirement = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageSettings) return;
    const name = newDocumentName.trim();
    if (name.length < 3) {
      setDocumentFormError('Informe um nome com pelo menos 3 caracteres.');
      return;
    }
    if (documentRequirements.some(requirement => requirement.name.localeCompare(name, 'pt-BR', { sensitivity: 'base' }) === 0)) {
      setDocumentFormError('Já existe um documento com esse nome.');
      return;
    }
    setDocumentRequirements(current => [...current, {
      type: documentTypeFromName(name, current),
      name,
      required: true,
      blocking: newDocumentBlocking,
      expiryRequired: newDocumentExpiryRequired,
      specialties: [],
      unitIds: [],
    }]);
    setNewDocumentName('');
    setNewDocumentExpiryRequired(false);
    setNewDocumentBlocking(true);
    setDocumentFormError('');
  };

  const removeDocumentRequirement = (type: string) => {
    if (!canManageSettings) return;
    setDocumentRequirements(current => current.filter(requirement => requirement.type !== type));
  };



  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column (Org General Details Form & Specialties) */}
      <div className="lg:col-span-2 space-y-6">
        {/* Org details form */}
        <div className="bg-card-bg rounded-xl border border-card-border p-6">
          <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <Building className="h-4 w-4 text-primary" />
            Perfil da Organização
          </h3>

          <form onSubmit={handleSaveOrgInfo} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Razão Social</label>
                <input
                  type="text"
                  required
                  disabled={!canManageSettings || saving}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">CNPJ da Empresa</label>
                <input
                  type="text"
                  required
                  disabled
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
                <span className="block text-[10px] font-normal text-text-muted">Gerenciado pelo administrador SaaS.</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Telefone Comercial</label>
                <input
                  type="text"
                  required
                  disabled={!canManageSettings || saving}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">E-mail Administrativo</label>
                <input
                  type="email"
                  required
                  disabled={!canManageSettings || saving}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Endereço de Faturamento</label>
              <input
                type="text"
                required
                disabled={!canManageSettings || saving}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
              />
            </div>

            <div className="pt-2 flex items-center justify-between">
              {isSaved ? (
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  Alterações salvas com sucesso!
                </span>
              ) : (
                <div />
              )}
              <button
                type="submit"
                disabled={!canManageSettings || saving}
                className="bg-primary hover:bg-primary-hover text-white rounded-lg py-2 px-4 font-semibold text-xs transition duration-200 cursor-pointer"
              >
                {saving ? 'Salvando…' : 'Salvar Alterações'}
              </button>
            </div>
          </form>
        </div>

        {/* Specialties Setup */}
        <div className="bg-card-bg rounded-xl border border-card-border p-6">
          <div className="mb-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
              <Briefcase className="h-4 w-4 text-primary" />
              Especialidades da empresa
            </h3>
            <p className="mt-1 text-xs text-text-muted">Catálogo exclusivo de {activeOrg.name}, usado nos médicos, unidades, setores e documentos.</p>
          </div>

          <div className="space-y-4">
            <form onSubmit={handleAddSpecialty} className="flex gap-2 text-xs">
              <input
                type="text"
                required
                disabled={!canManageSettings || saving}
                placeholder="Ex: Neurologia, Ortopedia..."
                value={newSpec}
                onChange={(e) => setNewSpec(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
              />
              <button
                type="submit"
                disabled={!canManageSettings || saving}
                className="bg-slate-800 hover:bg-slate-900 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-350 dark:border-slate-800 text-slate-200 font-semibold px-4 rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Adicionar
              </button>
            </form>

            {/* Badges list */}
            <div className="flex flex-wrap gap-1.5">
              {activeOrg.settings.specialties.map((spec: string) => (
                <span
                  key={spec}
                  className="inline-flex items-center gap-1 bg-background border border-card-border text-xs text-text-secondary px-3 py-1 rounded-lg"
                >
                  {spec}
                  <button
                    type="button"
                    disabled={!canManageSettings || saving}
                    onClick={() => handleRemoveSpecialty(spec)}
                    className="text-red-500 hover:text-red-750 font-bold ml-1 cursor-pointer font-mono"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-card-border bg-card-bg p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Documentos exigidos pela empresa
              </h3>
              <p className="mt-1 text-xs text-text-muted">Monte o checklist de {activeOrg.name} e defina quando cada item se aplica.</p>
            </div>
            <button type="button" className="nv-button shrink-0 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canManageSettings || saving} onClick={saveDocumentGovernance}>
              {saving ? 'Salvando…' : 'Salvar checklist'}
            </button>
          </div>

          {!canManageSettings && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5 text-xs text-text-muted">
              <Info size={15} className="mt-0.5 shrink-0 text-primary" />
              Esta visualização é somente leitura. Um usuário da empresa com permissão de edição em Configurações pode alterar o catálogo.
            </div>
          )}

          <form onSubmit={addDocumentRequirement} className="mt-5 rounded-xl border border-border bg-background/35 p-4">
            <div className="flex items-start gap-3">
              <FilePlus2 size={18} className="mt-0.5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold text-text-primary">Adicionar documento</p>
                <p className="mt-0.5 text-xs text-text-muted">O item será criado também para os médicos já cadastrados após salvar o checklist.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="nv-label flex-1">
                Nome do documento
                <input
                  className="nv-input mt-1"
                  list="document-name-suggestions"
                  maxLength={120}
                  required
                  disabled={!canManageSettings || saving}
                  placeholder="Ex.: Carteira do CRM, RQE ou ACLS"
                  value={newDocumentName}
                  onChange={event => { setNewDocumentName(event.target.value); setDocumentFormError(''); }}
                />
                <datalist id="document-name-suggestions">{DOCUMENT_NAME_SUGGESTIONS.map(name => <option key={name} value={name} />)}</datalist>
              </label>
              <button className="nv-button-secondary shrink-0 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canManageSettings || saving}>
                <Plus size={15} />Adicionar ao checklist
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-secondary">
              <label className="flex items-center gap-2"><input type="checkbox" disabled={!canManageSettings || saving} checked={newDocumentBlocking} onChange={event => setNewDocumentBlocking(event.target.checked)} />Pendência bloqueia escala</label>
              <label className="flex items-center gap-2"><input type="checkbox" disabled={!canManageSettings || saving} checked={newDocumentExpiryRequired} onChange={event => setNewDocumentExpiryRequired(event.target.checked)} />Exigir data de validade</label>
            </div>
            {documentFormError && <p role="alert" className="mt-3 text-xs font-medium text-danger">{documentFormError}</p>}
          </form>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded-xl border border-border p-4">
              <input type="checkbox" className="mt-1" disabled={!canManageSettings || saving} checked={documentGovernance.blockSchedulingOnCritical} onChange={event => setDocumentGovernance(current => ({ ...current, blockSchedulingOnCritical: event.target.checked }))} />
              <span><span className="flex items-center gap-1.5 text-sm font-semibold"><LockKeyhole size={14} className="text-danger" />Bloquear escala crítica</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">Impede novos plantões quando houver documento obrigatório vencido, reprovado ou ausente.</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border p-4">
              <input type="checkbox" className="mt-1" disabled={!canManageSettings || saving} checked={documentGovernance.internalNotifications} onChange={event => setDocumentGovernance(current => ({ ...current, internalNotifications: event.target.checked }))} />
              <span><span className="flex items-center gap-1.5 text-sm font-semibold"><BellRing size={14} className="text-primary" />Notificações internas</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">Mostra pendências e vencimentos no cabeçalho e no painel da empresa.</span></span>
            </label>
          </div>

          <div className="mt-5 rounded-xl border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><CalendarClock size={15} className="text-primary" />Antecedência dos alertas</p>
            <p className="mt-1 text-xs text-text-muted">Selecione quando um documento aprovado deve entrar na esteira de vencimento.</p>
            <div className="mt-3 flex flex-wrap gap-2">{[90, 60, 30, 7].map(day => { const active = documentGovernance.expiryAlertDays.includes(day); return <button type="button" key={day} disabled={!canManageSettings || saving} onClick={() => setDocumentGovernance(current => ({ ...current, expiryAlertDays: active ? current.expiryAlertDays.filter(value => value !== day) : [...current.expiryAlertDays, day].sort((a, b) => b - a) }))} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted hover:bg-state-hover'}`}>{day} dias</button>; })}</div>
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Checklist ({documentRequirements.length})</p>
              <span className="text-[11px] text-text-muted">Sem escopo selecionado = todos</span>
            </div>
            {!documentRequirements.length && <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">Nenhum documento configurado para esta empresa.</div>}
            {documentRequirements.map(requirement => (
              <details key={requirement.type} className="rounded-xl border border-border bg-background/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-text-primary">{requirement.name}</span><span className="mt-0.5 block text-[10px] text-text-muted">{requirement.specialties?.length ? `${requirement.specialties.length} especialidade(s)` : 'Todas as especialidades'} · {requirement.unitIds?.length ? `${requirement.unitIds.length} unidade(s)` : 'Todas as unidades'}</span></span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${requirement.required ? 'bg-primary/10 text-primary' : 'bg-surface-muted text-text-muted'}`}>{requirement.required ? 'Obrigatório' : 'Opcional'}</span>
                </summary>
                <div className="space-y-4 border-t border-border px-4 py-4">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <label className="flex items-center gap-2"><input type="checkbox" disabled={!canManageSettings || saving} checked={requirement.required} onChange={event => updateRequirement(requirement.type, { required: event.target.checked })} />Exigir documento</label>
                    <label className="flex items-center gap-2"><input type="checkbox" disabled={!canManageSettings || saving} checked={requirement.blocking !== false} onChange={event => updateRequirement(requirement.type, { blocking: event.target.checked })} />Pendência bloqueia escala</label>
                    <label className="flex items-center gap-2"><input type="checkbox" disabled={!canManageSettings || saving} checked={Boolean(requirement.expiryRequired)} onChange={event => updateRequirement(requirement.type, { expiryRequired: event.target.checked })} />Exigir validade</label>
                    <button type="button" disabled={!canManageSettings || saving} onClick={() => removeDocumentRequirement(requirement.type)} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-danger transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={13} />Remover exigência</button>
                  </div>
                  <div><p className="text-[11px] font-semibold text-text-muted">Especialidades</p><div className="mt-2 flex flex-wrap gap-1.5">{activeOrg.settings.specialties.map(specialty => <button type="button" disabled={!canManageSettings || saving} key={specialty} onClick={() => toggleScopeValue(requirement.type, 'specialties', specialty)} className={`rounded-md border px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${requirement.specialties?.includes(specialty) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted'}`}>{specialty}</button>)}</div></div>
                  <div><p className="text-[11px] font-semibold text-text-muted">Unidades</p><div className="mt-2 flex flex-wrap gap-1.5">{units.map(unit => <button type="button" disabled={!canManageSettings || saving} key={unit.id} onClick={() => toggleScopeValue(requirement.type, 'unitIds', unit.id)} className={`rounded-md border px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${requirement.unitIds?.includes(unit.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted'}`}>{unit.name}</button>)}{!units.length && <span className="text-xs text-text-muted">Cadastre uma unidade para restringir o escopo.</span>}</div></div>
                  <p className="text-[11px] leading-relaxed text-text-muted">Ao remover uma exigência, arquivos já enviados permanecem preservados no histórico.</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* Right Column (Theme, Compliance & Demo tools) */}
      <div className="space-y-6">
        {/* Appearance Settings */}
        <div className="bg-card-bg rounded-xl border border-card-border p-5 space-y-4">
          <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
            <Sun className="h-4 w-4 text-primary" />
            Aparência do sistema
          </h3>
          <p className="text-[11px] text-text-muted leading-relaxed">
            Escolha o tema visual de sua preferência para a interface do NV Med.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* Light Theme Card */}
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-left transition cursor-pointer ${
                theme === 'light'
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-slate-50 dark:hover:bg-slate-950'
              }`}
            >
              {/* Mini preview */}
              <div className="w-full h-12 bg-[#F7F9FB] rounded border border-slate-200 p-1 flex gap-1 select-none pointer-events-none">
                <div className="w-2.5 h-full bg-white border-r border-slate-200" />
                <div className="flex-1 flex flex-col gap-1">
                  <div className="h-1.5 w-6 bg-teal-700 rounded-sm" />
                  <div className="h-1 w-full bg-slate-200 rounded-sm" />
                  <div className="h-2 w-full bg-white rounded border border-slate-100" />
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Claro</span>
            </button>

            {/* Dark Theme Card */}
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-left transition cursor-pointer ${
                theme === 'dark'
                  ? 'border-teal-400 bg-primary/10'
                  : 'border-border hover:bg-slate-50 dark:hover:bg-slate-950'
              }`}
            >
              {/* Mini preview */}
              <div className="w-full h-12 bg-[#050607] rounded border border-slate-800 p-1 flex gap-1 select-none pointer-events-none">
                <div className="w-2.5 h-full bg-[#0A0C0F] border-r border-slate-800" />
                <div className="flex-1 flex flex-col gap-1">
                  <div className="h-1.5 w-6 bg-teal-450 rounded-sm" />
                  <div className="h-1 w-full bg-slate-800 rounded-sm" />
                  <div className="h-2 w-full bg-[#101418] rounded border border-slate-800" />
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Escuro (Dark)</span>
            </button>
          </div>
        </div>

        {/* Document list audit rules */}
        <div className="bg-card-bg rounded-xl border border-card-border p-5">
          <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Documentação de Regulação (Compliance)
          </h3>
          
          <div className="space-y-3.5">
            {documentRequirements.map((doc) => (
              <div key={doc.type} className="flex justify-between items-center text-xs pb-2 border-b border-border last:pb-0 last:border-b-0">
                <span className="font-medium text-text-secondary">{doc.name}</span>
                <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${doc.required ? 'bg-primary/10 text-primary' : 'bg-surface-muted text-text-muted'}`}>
                  {doc.required ? 'Obrigatório' : 'Opcional'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const {
    activeOrganizationId,
    organizations,
    units,
    updateOrganizationSettings,
    currentUser,
    saving,
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const activeUnits = units.filter(unit => unit.organizationId === activeOrganizationId);
  const canManageSettings = currentUser.type === 'tenant_user' && canEditPermission(currentUser, 'configuracoes');

  return (
    <AccessGuard requiredPermission="configuracoes">
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Page Heading */}
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Configurações Gerais</h2>
          <p className="text-sm text-text-muted mt-1">
            Ajustes cadastrais, regras de compliance, aparência e utilitários da empresa ativa.
          </p>
        </div>

        {activeOrg && <SettingsForm
          key={activeOrganizationId}
          activeOrg={activeOrg}
          activeOrganizationId={activeOrganizationId}
          updateOrganizationSettings={updateOrganizationSettings}
          units={activeUnits}
          canManageSettings={canManageSettings}
          saving={saving}
        />}
      </div>
    </AccessGuard>
  );
}
