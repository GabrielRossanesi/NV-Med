'use client';

import { useStore } from '@/store/useStore';
import AccessGuard from '@/components/AccessGuard';
import { 
  Building, 
  Users, 
  CalendarDays, 
  Building2, 
  ShieldAlert, 
  CreditCard, 
  TrendingUp, 
  ArrowRight, 
  Shield, 
  Plus, 
  Sparkles,
  Clock
} from 'lucide-react';
import Link from 'next/link';

export default function AdminDashboardPage() {
  const { organizations, doctors, units, shifts, documents, users } = useStore();

  // Metrics calculation
  const totalOrgs = organizations.length;
  const activeOrgs = organizations.filter(o => o.status === 'active').length;
  const setupOrgs = organizations.filter(o => o.status === 'setup').length;
  const suspendedOrgs = organizations.filter(o => o.status === 'suspended').length;

  const totalUsers = users.length;
  const totalDocsCount = doctors.length;
  const totalUnitsCount = units.length;
  const totalShiftsCount = shifts.length;

  // Documents across all orgs that require attention
  const totalPendingDocs = documents.filter(
    d => d.status === 'expired' || d.status === 'rejected' || d.status === 'analyzing'
  ).length;

  // Mock SaaS Financials
  // Platinum = R$ 1.999/mo, Gold = R$ 1.299/mo, Silver = R$ 799/mo
  const plansMRR: Record<string, number> = { platinum: 1999, gold: 1299, silver: 799 };
  const totalMRR = organizations.reduce((acc, org) => {
    if (org.status === 'active') {
      return acc + (plansMRR[org.plan || 'silver'] || 799);
    }
    return acc;
  }, 0);

  const delinquencyRate = 4.2; // Delinquency rate %
  const formattedMRR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalMRR);
  
  // Last platform logins mock data
  const lastLogins = [
    { name: 'Ana Souza', role: 'Diretor', orgName: 'NV Med Operadora Demo', time: 'Há 5 minutos' },
    { name: 'Gabriel Moraes', role: 'CEO', orgName: 'NV Med SaaS', time: 'Há 12 minutos' },
    { name: 'Paulo Mendes', role: 'Escalista', orgName: 'NV Med Operadora Demo', time: 'Há 1 hora' },
    { name: 'Lucas Oliveira', role: 'Gerente', orgName: 'Hospital São Lucas', time: 'Há 2 horas' },
    { name: 'Diego Santos', role: 'Escalista', orgName: 'Clínica Norte Saúde', time: 'Há 4 horas' },
  ];

  return (
    <AccessGuard requiredPermission="admin">
      <div className="space-y-8 animate-in fade-in duration-300">
        {/* Title */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text-primary tracking-tight flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Painel SaaS Admin
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Visão administrativa consolidada do NV Med. Gerencie clientes, licenças e acessos gerais.
            </p>
          </div>
          
          <div className="flex gap-2">
            <Link
              href="/admin/empresas"
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary text-text-inverse hover:bg-primary-hover rounded-xl shadow-glow-primary transition cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Nova Empresa
            </Link>
          </div>
        </div>

        {/* Top KPI Cards (Companies Status) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <div className="bg-card-bg border border-border p-4 rounded-2xl flex flex-col justify-between hover:border-border-strong transition duration-200 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-text-muted">Total de Empresas</span>
              <div className="bg-primary/10 text-primary p-2 rounded-xl">
                <Building className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-bold text-text-primary font-mono">{totalOrgs}</span>
              <p className="text-[10px] text-text-muted mt-1">Empresas registradas</p>
            </div>
          </div>

          <div className="bg-card-bg border border-border p-4 rounded-2xl flex flex-col justify-between hover:border-border-strong transition duration-200 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-text-muted">Empresas Ativas</span>
              <div className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 p-2 rounded-xl">
                <Building className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-500 font-mono">{activeOrgs}</span>
              <p className="text-[10px] text-text-muted mt-1">Gerando receita (MRR)</p>
            </div>
          </div>

          <div className="bg-card-bg border border-border p-4 rounded-2xl flex flex-col justify-between hover:border-border-strong transition duration-200 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-text-muted">Em Implantação</span>
              <div className="bg-amber-500/10 text-amber-600 dark:text-amber-500 p-2 rounded-xl">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-500 font-mono">{setupOrgs}</span>
              <p className="text-[10px] text-text-muted mt-1">Setup operacional</p>
            </div>
          </div>

          <div className="bg-card-bg border border-border p-4 rounded-2xl flex flex-col justify-between hover:border-border-strong transition duration-200 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-text-muted">Suspensas</span>
              <div className="bg-danger/10 text-danger p-2 rounded-xl">
                <ShieldAlert className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-2xl font-bold text-danger font-mono">{suspendedOrgs}</span>
              <p className="text-[10px] text-text-muted mt-1">Bloqueios por faturamento</p>
            </div>
          </div>
        </div>

        {/* Mid Operational Metrics & Financial SaaS Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* SaaS Operational Health */}
          <div className="bg-card-bg border border-border p-6 rounded-2xl shadow-soft space-y-6 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Métricas Gerais de Uso</h3>
              <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded font-bold">NV Med Geral</span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-surface-muted p-4 rounded-xl text-center">
                <Users className="h-5 w-5 text-text-muted mx-auto mb-2" />
                <span className="text-[10px] uppercase font-bold text-text-muted block">Usuários</span>
                <span className="text-lg font-bold text-text-primary mt-1 block font-mono">{totalUsers}</span>
              </div>
              <div className="bg-surface-muted p-4 rounded-xl text-center">
                <Users className="h-5 w-5 text-text-muted mx-auto mb-2" />
                <span className="text-[10px] uppercase font-bold text-text-muted block">Médicos</span>
                <span className="text-lg font-bold text-text-primary mt-1 block font-mono">{totalDocsCount}</span>
              </div>
              <div className="bg-surface-muted p-4 rounded-xl text-center">
                <Building2 className="h-5 w-5 text-text-muted mx-auto mb-2" />
                <span className="text-[10px] uppercase font-bold text-text-muted block">Unidades</span>
                <span className="text-lg font-bold text-text-primary mt-1 block font-mono">{totalUnitsCount}</span>
              </div>
              <div className="bg-surface-muted p-4 rounded-xl text-center">
                <CalendarDays className="h-5 w-5 text-text-muted mx-auto mb-2" />
                <span className="text-[10px] uppercase font-bold text-text-muted block">Plantões</span>
                <span className="text-lg font-bold text-text-primary mt-1 block font-mono">{totalShiftsCount}</span>
              </div>
            </div>

            {/* Platform Compliance Warning */}
            <div className="p-4 rounded-xl bg-danger/5 border border-danger/20 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-danger">Compliance Geral da Plataforma</p>
                <p className="text-text-muted">
                  Existem <strong className="text-text-primary">{totalPendingDocs}</strong> pendências documentais consolidadas (documentos expirados, reprovados ou em análise) que necessitam de intervenção dos administradores de escalas locais.
                </p>
              </div>
            </div>
          </div>

          {/* Financial SaaS Summary */}
          <div className="bg-card-bg border border-border p-6 rounded-2xl shadow-soft flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Financeiro SaaS
              </h3>
              
              <div className="space-y-4 mt-6">
                <div>
                  <span className="text-[10px] text-text-muted uppercase font-bold">Faturamento Estimado (MRR)</span>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-2xl font-bold text-text-primary font-mono">{formattedMRR}</span>
                    <span className="text-xs text-emerald-600 dark:text-emerald-500 font-bold flex items-center gap-0.5">
                      <TrendingUp className="h-3 w-3" />
                      +8.4%
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                  <div>
                    <span className="text-[10px] text-text-muted uppercase font-bold">Inadimplência</span>
                    <p className="text-sm font-bold text-danger mt-0.5 font-mono">{delinquencyRate}%</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-text-muted uppercase font-bold">LTV Médio</span>
                    <p className="text-sm font-bold text-text-primary mt-0.5 font-mono">R$ 15.400</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-border mt-6">
              <Link 
                href="/admin/empresas"
                className="text-xs font-bold text-primary hover:underline hover:text-primary-hover flex items-center justify-between cursor-pointer"
              >
                <span>Faturamento por empresa cliente</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom grid: Logins list & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Last Platform Accesses */}
          <div className="bg-card-bg border border-border p-6 rounded-2xl shadow-soft lg:col-span-2 space-y-4">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Últimos Acessos</h3>
            <div className="divide-y divide-border">
              {lastLogins.map((login, idx) => (
                <div key={idx} className="py-3 flex items-center justify-between gap-4 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                      {login.name[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{login.name}</p>
                      <p className="text-xs text-text-muted truncate">
                        {login.role} • <span className="italic">{login.orgName}</span>
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-text-muted flex-shrink-0 font-mono">{login.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Shortcuts */}
          <div className="bg-card-bg border border-border p-6 rounded-2xl shadow-soft space-y-4">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Atalhos Administrativos</h3>
            
            <div className="flex flex-col gap-3">
              <Link
                href="/admin/empresas"
                className="flex items-center justify-between p-4 bg-surface-muted border border-border hover:border-primary/30 rounded-xl transition duration-150 group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Building className="h-5 w-5 text-primary" />
                  <span className="text-sm font-semibold text-text-primary">Gerenciar Empresas</span>
                </div>
                <ArrowRight className="h-4 w-4 text-text-muted group-hover:text-primary transition" />
              </Link>

              <Link
                href="/admin/usuarios"
                className="flex items-center justify-between p-4 bg-surface-muted border border-border hover:border-primary/30 rounded-xl transition duration-150 group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-primary" />
                  <span className="text-sm font-semibold text-text-primary">Gerenciar Usuários</span>
                </div>
                <ArrowRight className="h-4 w-4 text-text-muted group-hover:text-primary transition" />
              </Link>

              <Link
                href="/admin/permissoes"
                className="flex items-center justify-between p-4 bg-surface-muted border border-border hover:border-primary/30 rounded-xl transition duration-150 group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <span className="text-sm font-semibold text-text-primary">Matriz de Permissões</span>
                </div>
                <ArrowRight className="h-4 w-4 text-text-muted group-hover:text-primary transition" />
              </Link>
            </div>

            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-3 mt-4">
              <Sparkles className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-text-muted leading-tight">
                <strong>Simulação de Acesso:</strong> Vá para a listagem de empresas, selecione um cliente e clique em &quot;Simular Acesso&quot; para auditar a conta como se você fizesse parte da equipe operational do hospital.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
