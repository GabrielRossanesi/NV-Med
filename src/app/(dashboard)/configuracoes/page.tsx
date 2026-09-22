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
  LockKeyhole
} from 'lucide-react';
import { useState } from 'react';
import { getDocumentGovernance } from '@/lib/documentGovernance';

interface SettingsFormProps {
  activeOrg: Organization;
  activeOrganizationId: string;
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>) => Promise<boolean>;
  units: Unit[];

}

function SettingsForm({
  activeOrg,
  activeOrganizationId,
  updateOrganizationSettings,
  units,
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

  const handleSaveOrgInfo = async (e: React.FormEvent) => {
    e.preventDefault();
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
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Telefone Comercial</label>
                <input
                  type="text"
                  required
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
                className="bg-primary hover:bg-primary-hover text-white rounded-lg py-2 px-4 font-semibold text-xs transition duration-200 cursor-pointer"
              >
                Salvar Alterações
              </button>
            </div>
          </form>
        </div>

        {/* Specialties Setup */}
        <div className="bg-card-bg rounded-xl border border-card-border p-6">
          <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <Briefcase className="h-4 w-4 text-primary" />
            Especialidades Clínicas Permitidas
          </h3>

          <div className="space-y-4">
            <form onSubmit={handleAddSpecialty} className="flex gap-2 text-xs">
              <input
                type="text"
                required
                placeholder="Ex: Neurologia, Ortopedia..."
                value={newSpec}
                onChange={(e) => setNewSpec(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-card-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
              />
              <button
                type="submit"
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-text-primary"><ShieldCheck className="h-4 w-4 text-primary"/>Governança documental</h3><p className="mt-1 text-xs text-text-muted">Defina alertas, bloqueios e o escopo dos documentos exigidos.</p></div><button type="button" className="nv-button" onClick={saveDocumentGovernance}>Salvar regras</button></div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="flex items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" className="mt-1" checked={documentGovernance.blockSchedulingOnCritical} onChange={event => setDocumentGovernance(current => ({ ...current, blockSchedulingOnCritical: event.target.checked }))}/><span><span className="flex items-center gap-1.5 text-sm font-semibold"><LockKeyhole size={14} className="text-danger"/>Bloquear escala crítica</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">Impede novos plantões quando houver documento obrigatório vencido, reprovado ou ausente.</span></span></label>
            <label className="flex items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" className="mt-1" checked={documentGovernance.internalNotifications} onChange={event => setDocumentGovernance(current => ({ ...current, internalNotifications: event.target.checked }))}/><span><span className="flex items-center gap-1.5 text-sm font-semibold"><BellRing size={14} className="text-primary"/>Notificações internas</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">Mostra pendências e vencimentos no cabeçalho e no painel da empresa.</span></span></label>
          </div>

          <div className="mt-5 rounded-xl border border-border p-4"><p className="flex items-center gap-2 text-sm font-semibold"><CalendarClock size={15} className="text-primary"/>Antecedência dos alertas</p><p className="mt-1 text-xs text-text-muted">Selecione quando um documento aprovado deve entrar na esteira de vencimento.</p><div className="mt-3 flex flex-wrap gap-2">{[90,60,30,7].map(day => { const active = documentGovernance.expiryAlertDays.includes(day); return <button type="button" key={day} onClick={() => setDocumentGovernance(current => ({ ...current, expiryAlertDays: active ? current.expiryAlertDays.filter(value => value !== day) : [...current.expiryAlertDays, day].sort((a,b)=>b-a) }))} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted hover:bg-state-hover'}`}>{day} dias</button>; })}</div></div>

          <div className="mt-5 space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Checklist obrigatório</p>{documentRequirements.map(requirement => <details key={requirement.type} className="rounded-xl border border-border bg-background/40"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"><span className="text-sm font-semibold text-text-primary">{requirement.name}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${requirement.required ? 'bg-primary/10 text-primary' : 'bg-surface-muted text-text-muted'}`}>{requirement.required ? 'Obrigatório' : 'Opcional'}</span></summary><div className="space-y-4 border-t border-border px-4 py-4"><div className="flex flex-wrap gap-4 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={requirement.required} onChange={event => updateRequirement(requirement.type,{required:event.target.checked})}/>Exigir documento</label><label className="flex items-center gap-2"><input type="checkbox" checked={requirement.blocking !== false} onChange={event => updateRequirement(requirement.type,{blocking:event.target.checked})}/>Pendência bloqueia escala</label><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(requirement.expiryRequired)} onChange={event => updateRequirement(requirement.type,{expiryRequired:event.target.checked})}/>Exigir validade</label></div><div><p className="text-[11px] font-semibold text-text-muted">Especialidades — vazio significa todas</p><div className="mt-2 flex flex-wrap gap-1.5">{activeOrg.settings.specialties.map(specialty => <button type="button" key={specialty} onClick={() => toggleScopeValue(requirement.type,'specialties',specialty)} className={`rounded-md border px-2 py-1 text-[11px] ${requirement.specialties?.includes(specialty) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted'}`}>{specialty}</button>)}</div></div><div><p className="text-[11px] font-semibold text-text-muted">Unidades — vazio significa todas</p><div className="mt-2 flex flex-wrap gap-1.5">{units.map(unit => <button type="button" key={unit.id} onClick={() => toggleScopeValue(requirement.type,'unitIds',unit.id)} className={`rounded-md border px-2 py-1 text-[11px] ${requirement.unitIds?.includes(unit.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted'}`}>{unit.name}</button>)}{!units.length && <span className="text-xs text-text-muted">Cadastre uma unidade para restringir o escopo.</span>}</div></div></div></details>)}</div>
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
            {activeOrg.settings.requiredDocuments.map((doc, idx: number) => (
              <div key={idx} className="flex justify-between items-center text-xs pb-2 border-b border-border last:pb-0 last:border-b-0">
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
    updateOrganizationSettings
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const activeUnits = units.filter(unit => unit.organizationId === activeOrganizationId);

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
        />}
      </div>
    </AccessGuard>
  );
}
