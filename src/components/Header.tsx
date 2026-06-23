'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Bell, ShieldAlert, Sparkles, Building, Sun, Moon, ChevronDown, EyeOff, Shield } from 'lucide-react';
import Link from 'next/link';
import ProfileSelectorModal from './ProfileSelectorModal';

export default function Header() {
  const {
    activeOrganizationId,
    organizations,
    documents,
    theme,
    setTheme,
    setActiveOrganizationId,
    currentUser,
    isSimulating,
    stopSimulation
  } = useStore();

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  
  // Calculate document alerts for active organization
  const activeOrgDocs = documents.filter((d) => d.organizationId === activeOrganizationId);
  const pendingOrAlertDocs = activeOrgDocs.filter(
    (d) => d.status === 'analyzing' || d.status === 'expired' || d.status === 'rejected'
  ).length;

  const initials = currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2);

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-header-bg/85 backdrop-blur-md px-6 md:px-8 shadow-soft">
        {/* Left side: Breadcrumb / Active Company indicator */}
        <div className="flex items-center gap-3">
          {/* Mobile Company Switcher - Hide if tenant user (who is locked to their company) */}
          {currentUser.type === 'saas_admin' && (
            <div className="md:hidden relative flex items-center bg-primary/10 text-primary px-2.5 py-1.5 rounded-lg text-xs font-bold border border-primary/20 hover:bg-primary/15 transition pr-6">
              <Building className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
              <select
                value={activeOrganizationId}
                onChange={(e) => setActiveOrganizationId(e.target.value)}
                className="bg-transparent font-bold text-primary outline-none appearance-none cursor-pointer pr-1"
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id} className="bg-card-bg text-text-primary">
                    {org.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="h-3.5 w-3.5 text-primary absolute right-1.5 pointer-events-none" />
            </div>
          )}

          {/* Desktop Indicator - Active Company or SaaS Context */}
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            {currentUser.type === 'saas_admin' && !isSimulating ? (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                Painel Geral SaaS
              </span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20 flex items-center gap-1">
                <Sparkles className="h-3 w-3 animate-pulse text-amber-500" />
                Empresa: {activeOrg?.name}
              </span>
            )}
            <span className="text-[10px] bg-surface-muted text-text-muted px-2 py-0.5 rounded font-mono uppercase tracking-wider">
              Demo Mode
            </span>
          </div>

          {/* Simulation Alert Badge (Mobile/Desktop) */}
          {isSimulating && (
            <div className="flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 rounded-lg px-2.5 py-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <span className="flex items-center gap-1 font-bold animate-pulse">
                <EyeOff className="h-3.5 w-3.5 text-amber-500" />
                Simulando
              </span>
              <span className="hidden lg:inline text-[10px] opacity-80">({activeOrg?.name})</span>
              <button
                onClick={stopSimulation}
                className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] px-2 py-0.5 rounded transition cursor-pointer"
              >
                Sair
              </button>
            </div>
          )}
        </div>

        {/* Right side: Alert indicators + Theme toggle + Notification + Profile */}
        <div className="flex items-center gap-4">
          {currentUser.type === 'tenant_user' && pendingOrAlertDocs > 0 && (
            <Link
              href="/documentos"
              className="flex items-center gap-1.5 text-danger bg-danger/10 px-2.5 py-1 rounded-full text-xs font-medium border border-danger/20 animate-pulse"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Pendências:</span>
              <span className="font-bold">{pendingOrAlertDocs}</span>
            </Link>
          )}

          {/* Theme Toggle Button */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2.5 md:p-1.5 h-10 w-10 md:h-8 md:w-8 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-muted transition cursor-pointer"
            title={theme === 'dark' ? 'Alternar para Tema Claro' : 'Alternar para Tema Escuro'}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 text-primary" />
            ) : (
              <Moon className="h-4 w-4 text-primary" />
            )}
          </button>

          {/* Notification Bell */}
          <button className="relative p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-muted transition cursor-pointer">
            <Bell className="h-4 w-4" />
            {currentUser.type === 'tenant_user' && pendingOrAlertDocs > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            )}
          </button>

          {/* Active Profile Trigger (Avatar + Name) */}
          <button
            onClick={() => setIsProfileModalOpen(true)}
            className="flex items-center gap-2 border-l border-border pl-4 text-left hover:opacity-85 transition group cursor-pointer"
            title="Clique para alternar perfil ativo de demonstração"
          >
            <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-text-inverse shadow-sm group-hover:scale-105 transition duration-150 ${
              currentUser.type === 'saas_admin' ? 'bg-primary' : 'bg-amber-500'
            }`}>
              {initials}
            </div>
            <div className="hidden sm:flex flex-col">
              <span className="text-xs font-semibold text-text-primary flex items-center gap-0.5">
                {currentUser.name}
                <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
              </span>
              <span className="text-[9px] text-text-muted leading-tight font-medium">
                {currentUser.role} {currentUser.type === 'saas_admin' ? '(SaaS)' : ''}
              </span>
            </div>
          </button>
        </div>
      </header>

      {/* Profile Selector Modal */}
      <ProfileSelectorModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
    </>
  );
}
