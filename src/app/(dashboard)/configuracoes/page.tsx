'use client';

import { useStore } from '@/store/useStore';
import { Organization } from '@/types';
import {
  Building,
  Wrench,
  RotateCcw,
  ShieldCheck,
  CheckCircle,
  Plus,
  Briefcase,
  Sun
} from 'lucide-react';
import { useState } from 'react';

interface SettingsFormProps {
  activeOrg: Organization;
  activeOrganizationId: string;
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>) => void;
  resetToMockData: () => void;
}

function SettingsForm({
  activeOrg,
  activeOrganizationId,
  updateOrganizationSettings,
  resetToMockData
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

  const handleSaveOrgInfo = (e: React.FormEvent) => {
    e.preventDefault();
    updateOrganizationSettings(activeOrganizationId, {
      name,
      cnpj,
      phone,
      email,
      address
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleAddSpecialty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpec.trim()) return;

    if (activeOrg.settings.specialties.includes(newSpec.trim())) {
      alert('Esta especialidade já está cadastrada.');
      return;
    }

    const updatedSpecs = [...activeOrg.settings.specialties, newSpec.trim()];
    updateOrganizationSettings(activeOrganizationId, {
      settings: {
        ...activeOrg.settings,
        specialties: updatedSpecs
      }
    });
    setNewSpec('');
  };

  const handleRemoveSpecialty = (spec: string) => {
    const updatedSpecs = activeOrg.settings.specialties.filter((s) => s !== spec);
    updateOrganizationSettings(activeOrganizationId, {
      settings: {
        ...activeOrg.settings,
        specialties: updatedSpecs
      }
    });
  };

  const handleResetDemo = () => {
    if (confirm('Atenção: Isso irá apagar todas as alterações do localStorage e restaurar os dados iniciais da demo. Deseja continuar?')) {
      resetToMockData();
      window.location.reload();
    }
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
                <span className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                  Obrigatório
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Demonstration utilities */}
        <div className="bg-card-bg rounded-xl border border-card-border p-5 space-y-4">
          <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
            <Wrench className="h-4 w-4 text-text-muted" />
            Ambiente de Demonstração
          </h3>
          <p className="text-[11px] text-text-muted leading-relaxed">
            Utilitários para reconfigurar a demonstração comercial do NV Med de volta ao estado inicial.
          </p>

          <button
            onClick={handleResetDemo}
            className="w-full bg-surface-muted hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-900 border border-border text-text-primary py-2.5 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar Dados Originais
          </button>
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
    resetToMockData
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Heading */}
      <div>
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">Configurações Gerais</h2>
        <p className="text-sm text-text-muted mt-1">
          Ajustes cadastrais, regras de compliance, aparência e utilitários da empresa ativa.
        </p>
      </div>

      <SettingsForm
        key={activeOrganizationId}
        activeOrg={activeOrg}
        activeOrganizationId={activeOrganizationId}
        updateOrganizationSettings={updateOrganizationSettings}
        resetToMockData={resetToMockData}
      />
    </div>
  );
}
