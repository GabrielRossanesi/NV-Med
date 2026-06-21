'use client';

import { useStore } from '@/store/useStore';
import { useRouter } from 'next/navigation';
import {
  Building,
  Users,
  Calendar,
  Building2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Globe,
  Phone,
  Mail
} from 'lucide-react';

export default function CompaniesPage() {
  const router = useRouter();
  const {
    organizations,
    activeOrganizationId,
    setActiveOrganizationId,
    doctors,
    units,
    shifts,
    documents
  } = useStore();

  const handleAccessCompany = (orgId: string) => {
    setActiveOrganizationId(orgId);
    router.push('/dashboard');
  };

  // Calculate totals across all tenants
  const totalOrgs = organizations.length;
  const grandTotalDocs = doctors.length;
  const grandTotalUnits = units.length;
  const grandTotalShifts = shifts.length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Page Heading */}
      <div>
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">
          Central Multiempresas
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Gerenciamento e simulação de acessos do operador para todas as organizações médicas cadastradas na plataforma.
        </p>
      </div>

      {/* Global SaaS Platform Summary */}
      <div className="bg-slate-950 text-slate-200 p-6 rounded-xl border border-slate-800 relative overflow-hidden">
        {/* Decorative Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <span className="text-[10px] bg-primary/10 text-primary border border-teal-900/30 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">
              Painel de Operador Geral
            </span>
            <h3 className="text-xl font-bold text-white mt-2">Visão Consolidada do SaaS</h3>
            <p className="text-xs text-text-muted mt-1">Dados acumulados em todas as instâncias de clínicas e hospitais.</p>
          </div>

          <div className="grid grid-cols-4 gap-4 md:gap-8 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
            <div className="text-center px-2">
              <span className="text-[10px] uppercase font-bold text-text-muted block">Clientes</span>
              <span className="text-lg font-bold text-primary mt-1 block">{totalOrgs}</span>
            </div>
            <div className="text-center px-2 border-l border-slate-800">
              <span className="text-[10px] uppercase font-bold text-text-muted block">Médicos</span>
              <span className="text-lg font-bold text-white mt-1 block">{grandTotalDocs}</span>
            </div>
            <div className="text-center px-2 border-l border-slate-800">
              <span className="text-[10px] uppercase font-bold text-text-muted block">Unidades</span>
              <span className="text-lg font-bold text-white mt-1 block">{grandTotalUnits}</span>
            </div>
            <div className="text-center px-2 border-l border-slate-800">
              <span className="text-[10px] uppercase font-bold text-text-muted block">Plantões</span>
              <span className="text-lg font-bold text-white mt-1 block">{grandTotalShifts}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Companies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {organizations.map((org) => {
          const isActive = org.id === activeOrganizationId;
          
          // Calculate organization specific metrics
          const docCount = doctors.filter((d) => d.organizationId === org.id).length;
          const unitCount = units.filter((u) => u.organizationId === org.id).length;
          const shiftCount = shifts.filter((s) => s.organizationId === org.id).length;
          const pendingDocs = documents.filter(
            (d) => d.organizationId === org.id && (d.status === 'analyzing' || d.status === 'expired' || d.status === 'rejected')
          ).length;

          return (
            <div
              key={org.id}
              className={`bg-card-bg rounded-xl border flex flex-col justify-between overflow-hidden transition-all duration-300 ${
                isActive
                  ? 'border-primary shadow-lg ring-1 ring-teal-500/20'
                  : 'border-border hover:border-slate-350 dark:hover:border-slate-700'
              }`}
            >
              {/* Card Header */}
              <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl flex items-center justify-center ${
                      isActive ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-slate-800 text-text-secondary'
                    }`}>
                      <Building className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-text-primary leading-tight">{org.name}</h4>
                      <p className="text-[10px] text-text-muted mt-0.5">CNPJ: {org.cnpj}</p>
                    </div>
                  </div>
                  {isActive && (
                    <span className="text-[9px] bg-primary text-white px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                      Ativa
                    </span>
                  )}
                </div>
              </div>

              {/* Company Info/Metadata */}
              <div className="p-6 space-y-4 flex-1">
                <div className="space-y-2 text-xs text-text-muted">
                  <p className="flex items-start gap-2">
                    <Globe className="h-4 w-4 text-text-muted flex-shrink-0" />
                    <span className="truncate">{org.address}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-text-muted flex-shrink-0" />
                    <span>{org.phone}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-text-muted flex-shrink-0" />
                    <span className="truncate">{org.email}</span>
                  </p>
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                  <p className="text-[10px] uppercase font-bold text-text-muted tracking-wider mb-2.5">
                    Resumo de Instância
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-background p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/50 flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" />
                      <div>
                        <span className="block text-[10px] text-text-muted">Médicos</span>
                        <span className="font-bold text-text-secondary">{docCount}</span>
                      </div>
                    </div>

                    <div className="bg-background p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/50 flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      <div>
                        <span className="block text-[10px] text-text-muted">Unidades</span>
                        <span className="font-bold text-text-secondary">{unitCount}</span>
                      </div>
                    </div>

                    <div className="bg-background p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/50 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      <div>
                        <span className="block text-[10px] text-text-muted">Plantões</span>
                        <span className="font-bold text-text-secondary">{shiftCount}</span>
                      </div>
                    </div>

                    <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                      pendingDocs > 0
                        ? 'bg-amber-500/5 border-amber-500/10 text-amber-600'
                        : 'bg-background border-slate-100 dark:border-slate-800/50 text-text-muted'
                    }`}>
                      <AlertTriangle className={`h-4 w-4 ${pendingDocs > 0 ? 'text-amber-500' : 'text-text-muted'}`} />
                      <div>
                        <span className="block text-[10px] text-text-muted">Pendências</span>
                        <span className="font-bold">{pendingDocs}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/10">
                <button
                  onClick={() => handleAccessCompany(org.id)}
                  className={`w-full py-2.5 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition duration-200 ${
                    isActive
                      ? 'bg-primary hover:bg-primary-hover text-white shadow-md'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {isActive ? 'Painel já Ativo' : 'Acessar Instância'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Help Banner */}
      <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-card-border flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1 text-text-muted">
          <p className="font-semibold text-slate-850 dark:text-slate-200">Garantia de Isolamento de Dados</p>
          <p>
            O NV Med opera sob arquitetura de inquilino único virtual (multi-tenant logical separation). A troca de tenant reconfigura todos os seletores locais de consulta para aplicar a cláusula `where organizationId = activeOrganizationId`, impedindo vazamento de dados de médicos ou escalas entre diferentes clientes corporativos.
          </p>
        </div>
      </div>
    </div>
  );
}
