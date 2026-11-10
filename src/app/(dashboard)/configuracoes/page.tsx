'use client';

import { useStore } from '@/store/useStore';
import { Organization } from '@/types';
import AccessGuard from '@/components/AccessGuard';
import {
  Building,
  ShieldCheck,
  CheckCircle,
  Plus,
  Briefcase,
  Sun,
  ArrowRight
} from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { canEditPermission } from '@/lib/permissions';

interface SettingsFormProps {
  activeOrg: Organization;
  activeOrganizationId: string;
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>) => Promise<boolean>;
  canManageSettings: boolean;
  saving: boolean;
}

function SettingsForm({
  activeOrg,
  activeOrganizationId,
  updateOrganizationSettings,
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
                  className="nv-input"
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
                  className="nv-input"
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
                  className="nv-input"
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
                  className="nv-input"
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
                className="nv-input"
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
                className="bg-primary hover:bg-primary-hover text-text-inverse rounded-lg py-2 px-4 font-semibold text-xs transition duration-200 cursor-pointer"
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
                className="nv-input flex-1"
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

        <section className="border-y border-border py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={17} className="text-primary" />Documentação médica</h3><p className="mt-2 max-w-lg text-sm text-text-muted">Configure os documentos obrigatórios de {activeOrg.name} para toda a empresa ou unidades específicas.</p><p className="mt-2 text-xs text-text-muted">{activeOrg.settings.requiredDocuments.length} exigências cadastradas</p></div>
            <Link href="/configuracoes/documentos" className="nv-button-secondary">Gerenciar exigências <ArrowRight size={15} /></Link>
          </div>
        </section>
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

      </div>
    </div>
  );
}

export default function SettingsPage() {
  const {
    activeOrganizationId,
    organizations,
    updateOrganizationSettings,
    currentUser,
    saving,
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId);
  const canManageSettings = currentUser.type === 'tenant_user' && canEditPermission(currentUser, 'configuracoes');

  return (
    <AccessGuard requiredPermission="configuracoes">
      <div className="space-y-6 animate-in fade-in duration-300">
        {/* Page Heading */}
        <div>
          <h2 className="nv-page-title">Perfil da empresa</h2>
          <p className="text-sm text-text-muted mt-1">
            Dados da empresa, especialidades e exigências de documentação médica.
          </p>
        </div>

        {activeOrg && <SettingsForm
          key={activeOrganizationId}
          activeOrg={activeOrg}
          activeOrganizationId={activeOrganizationId}
          updateOrganizationSettings={updateOrganizationSettings}
          canManageSettings={canManageSettings}
          saving={saving}
        />}
      </div>
    </AccessGuard>
  );
}
