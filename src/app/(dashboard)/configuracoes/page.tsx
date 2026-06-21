'use client';

import { useStore } from '@/store/useStore';
import {
  Building,
  Wrench,
  RotateCcw,
  ShieldCheck,
  CheckCircle,
  Plus,
  Briefcase
} from 'lucide-react';
import { useState } from 'react';

export default function SettingsPage() {
  const {
    activeOrganizationId,
    organizations,
    updateOrganizationSettings,
    resetToMockData
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];

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
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Heading */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Configurações Gerais</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Ajustes cadastrais, regras de compliance e utilitários da empresa ativa.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column (Org General Details Form) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Org details form */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Building className="h-4 w-4 text-teal-650 dark:text-teal-400" />
              Perfil da Organização
            </h3>

            <form onSubmit={handleSaveOrgInfo} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Razão Social</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CNPJ da Empresa</label>
                  <input
                    type="text"
                    required
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Telefone Comercial</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">E-mail Administrativo</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Endereço de Faturamento</label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
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
                  className="bg-teal-500 hover:bg-teal-600 text-white rounded-lg py-2 px-4 font-semibold text-xs transition duration-200"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>

          {/* Specialties Setup */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Briefcase className="h-4 w-4 text-teal-655 dark:text-teal-400" />
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
                  className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                />
                <button
                  type="submit"
                  className="bg-slate-800 hover:bg-slate-950 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-350 dark:border-slate-800 text-slate-700 dark:text-slate-200 font-semibold px-4 rounded-lg flex items-center gap-1"
                >
                  <Plus className="h-4.5 w-4.5" />
                  Adicionar
                </button>
              </form>

              {/* Badges list */}
              <div className="flex flex-wrap gap-1.5">
                {activeOrg.settings.specialties.map((spec) => (
                  <span
                    key={spec}
                    className="inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-650 dark:text-slate-300 px-3 py-1 rounded-lg"
                  >
                    {spec}
                    <button
                      type="button"
                      onClick={() => handleRemoveSpecialty(spec)}
                      className="text-red-500 hover:text-red-700 font-bold ml-1"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (Mandatory checklist items & Demo tools) */}
        <div className="space-y-6">
          {/* Document list audit rules */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-xs font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-teal-650 dark:text-teal-400" />
              Documentação de Regulação (Compliance)
            </h3>
            
            <div className="space-y-3.5">
              {activeOrg.settings.requiredDocuments.map((doc, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs pb-2 border-b border-slate-100 dark:border-slate-850 last:pb-0 last:border-b-0">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{doc.name}</span>
                  <span className="text-[9px] bg-teal-500/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    Obrigatório
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Demonstration utilities */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-950 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <Wrench className="h-4 w-4 text-slate-500" />
              Ambiente de Demonstração
            </h3>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Utilitários para reconfigurar a demonstração comercial do NV Med de volta ao estado inicial.
            </p>

            <button
              onClick={handleResetDemo}
              className="w-full bg-slate-900 hover:bg-slate-950 border border-slate-855 text-white py-2.5 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar Dados Originais
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
