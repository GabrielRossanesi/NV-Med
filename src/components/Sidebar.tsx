'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  LayoutDashboard,
  Users,
  Building2,
  CalendarDays,
  FileText,
  Settings,
  Building,
  LogOut,
  ChevronDown,
  Activity
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);

  const {
    activeOrganizationId,
    organizations,
    setActiveOrganizationId,
    currentUser
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const otherOrgs = organizations.filter((o) => o.id !== activeOrganizationId);

  const menuItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Médicos', href: '/medicos', icon: Users },
    { name: 'Escala de Plantões', href: '/escala', icon: CalendarDays },
    { name: 'Unidades', href: '/unidades', icon: Building2 },
    { name: 'Documentos', href: '/documentos', icon: FileText },
    { name: 'Configurações', href: '/configuracoes', icon: Settings },
  ];

  const handleOrgSwitch = (orgId: string) => {
    setActiveOrganizationId(orgId);
    setIsOrgDropdownOpen(false);
    // Refresh current dashboard or details to avoid stale data
    router.refresh();
  };

  const handleLogout = () => {
    router.push('/login');
  };

  return (
    <>
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-64 border-r border-sidebar-border bg-sidebar-bg/95 backdrop-blur-md h-screen fixed left-0 top-0 z-20 shadow-soft">
        {/* Brand / Logo + Org Selector */}
        <div className="p-4 border-b border-sidebar-border relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-primary text-text-inverse p-1.5 rounded-lg flex items-center justify-center shadow-glow-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-text-primary tracking-tight">NV Med</h1>
              <span className="text-[10px] text-primary font-semibold tracking-wider uppercase">SaaS Gestão</span>
            </div>
          </div>

          {/* Org Selector Button */}
          <button
            onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
            className="w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-input-bg border border-input-border text-left hover:border-border-strong transition duration-150 cursor-pointer"
          >
            <div className="min-w-0">
              <p className="text-[10px] text-text-muted font-medium uppercase tracking-wider">Empresa Ativa</p>
              <p className="text-xs font-semibold text-text-secondary truncate">{activeOrg?.name}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
          </button>

          {/* Org Dropdown */}
          {isOrgDropdownOpen && (
            <div className="absolute left-4 right-4 mt-1 bg-surface-elevated border border-border rounded-lg shadow-medium z-30 p-1">
              <p className="text-[10px] text-text-muted font-semibold uppercase p-2 tracking-wider">Alternar Empresa</p>
              {otherOrgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleOrgSwitch(org.id)}
                  className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-state-hover text-left transition duration-150 cursor-pointer"
                >
                  <Building className="h-4 w-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text-secondary truncate">{org.name}</p>
                  </div>
                </button>
              ))}
              <div className="border-t border-border my-1"></div>
              <Link
                href="/empresas"
                onClick={() => setIsOrgDropdownOpen(false)}
                className="flex items-center gap-2 p-2 text-xs text-primary hover:bg-primary/10 rounded-md font-semibold transition"
              >
                <Building className="h-4 w-4" />
                Painel Multiempresas
              </Link>
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition duration-150 ${
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-text-secondary hover:bg-state-hover hover:text-text-primary'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-text-muted'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer Info / Operator */}
        <div className="p-3 border-t border-sidebar-border bg-surface-muted/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
              GM
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text-secondary truncate">{currentUser.name}</p>
              <p className="text-[10px] text-text-muted truncate">{currentUser.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-semibold text-danger hover:bg-danger/10 border border-transparent hover:border-danger/25 transition duration-150 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair do Painel
          </button>
        </div>
      </aside>

      {/* Mobile Header / Bottom Nav or Drawer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-sidebar-bg/95 border-t border-sidebar-border backdrop-blur-md p-2 flex justify-around items-center shadow-soft">
        {menuItems.slice(0, 5).map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 p-1 text-[10px] font-medium ${
                isActive
                  ? 'text-primary'
                  : 'text-text-secondary'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.name.split(' ')[0]}</span>
            </Link>
          );
        })}
        <Link
          href="/empresas"
          className={`flex flex-col items-center gap-1 p-1 text-[10px] font-medium ${
            pathname === '/empresas'
              ? 'text-primary'
              : 'text-text-secondary'
          }`}
        >
          <Building className="h-5 w-5" />
          <span>Empresas</span>
        </Link>
      </div>
    </>
  );
}
