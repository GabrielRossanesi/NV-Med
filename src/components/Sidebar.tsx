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
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 h-screen fixed left-0 top-0 z-20">
        {/* Brand / Logo + Org Selector */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-teal-500 text-white p-1.5 rounded-lg flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">NV Med</h1>
              <span className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold tracking-wider uppercase">SaaS Gestão</span>
            </div>
          </div>

          {/* Org Selector Button */}
          <button
            onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
            className="w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-left hover:border-slate-300 dark:hover:border-slate-700 transition duration-150"
          >
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Empresa Ativa</p>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{activeOrg?.name}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
          </button>

          {/* Org Dropdown */}
          {isOrgDropdownOpen && (
            <div className="absolute left-4 right-4 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl z-30 p-1">
              <p className="text-[10px] text-slate-400 font-semibold uppercase p-2 tracking-wider">Alternar Empresa</p>
              {otherOrgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleOrgSwitch(org.id)}
                  className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-950 text-left transition duration-150"
                >
                  <Building className="h-4 w-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{org.name}</p>
                  </div>
                </button>
              ))}
              <div className="border-t border-slate-100 dark:border-slate-800 my-1"></div>
              <Link
                href="/empresas"
                onClick={() => setIsOrgDropdownOpen(false)}
                className="flex items-center gap-2 p-2 text-xs text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/20 rounded-md font-semibold transition"
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
                    ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-950 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400 group-hover:text-slate-500'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer Info / Operator */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-sm">
              GM
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{currentUser.name}</p>
              <p className="text-[10px] text-slate-400 truncate">{currentUser.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 border border-transparent hover:border-red-100 dark:hover:border-red-900/30 transition duration-150"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair do Painel
          </button>
        </div>
      </aside>

      {/* Mobile Header / Bottom Nav or Drawer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-2 flex justify-around items-center">
        {menuItems.slice(0, 5).map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 p-1 text-[10px] font-medium ${
                isActive
                  ? 'text-teal-500'
                  : 'text-slate-500 dark:text-slate-400'
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
              ? 'text-teal-500'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Building className="h-5 w-5" />
          <span>Empresas</span>
        </Link>
      </div>
    </>
  );
}
