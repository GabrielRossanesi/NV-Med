'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Activity,
  Building,
  Building2,
  CalendarDays,
  ChevronDown,
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { ROLE_PERMISSIONS } from './AccessGuard';
import UserAvatar from './UserAvatar';

const operationalItems = [
  { name: 'Dashboard', shortName: 'Início', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard' },
  { name: 'Médicos', shortName: 'Médicos', href: '/medicos', icon: Users, permission: 'medicos' },
  { name: 'Escalas', shortName: 'Escalas', href: '/escala', icon: CalendarDays, permission: 'escala' },
  { name: 'Unidades', shortName: 'Unidades', href: '/unidades', icon: Building2, permission: 'unidades' },
  { name: 'Documentos', shortName: 'Docs', href: '/documentos', icon: FileText, permission: 'documentos' },
  { name: 'Configurações', shortName: 'Ajustes', href: '/configuracoes', icon: Settings, permission: 'configuracoes' },
];

const adminItems = [
  { name: 'Visão SaaS', shortName: 'SaaS', href: '/admin', icon: LayoutDashboard, permission: 'admin' },
  { name: 'Empresas', shortName: 'Empresas', href: '/admin/empresas', icon: Building, permission: 'empresas' },
  { name: 'Usuários', shortName: 'Usuários', href: '/admin/usuarios', icon: Users, permission: 'usuarios' },
  { name: 'Permissões', shortName: 'Acessos', href: '/admin/permissoes', icon: Shield, permission: 'permissoes' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const {
    activeOrganizationId,
    organizations,
    setActiveOrganizationId,
    currentUser,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useStore();

  const activeOrg = organizations.find((org) => org.id === activeOrganizationId) || organizations[0];
  const permissions = ROLE_PERMISSIONS[`${currentUser.type}:${currentUser.role}`] || [];
  const items = [
    ...(currentUser.type === 'saas_admin' ? adminItems : []),
    ...operationalItems,
  ].filter((item) => permissions.includes(item.permission));

  const switchOrganization = (organizationId: string) => {
    setActiveOrganizationId(organizationId);
    setOrgMenuOpen(false);
    router.refresh();
  };

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar-bg/96 backdrop-blur-xl transition-[width] duration-200 md:flex ${sidebarCollapsed ? 'w-[72px]' : 'w-60'}`}
      >
        <div className={`flex h-16 items-center border-b border-sidebar-border ${sidebarCollapsed ? 'justify-center px-3' : 'justify-between px-4'}`}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" aria-label="NV Med — início">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-text-inverse shadow-glow-primary">
              <Activity className="h-[18px] w-[18px]" />
            </span>
            {!sidebarCollapsed && (
              <span className="min-w-0">
                <span className="block text-[15px] font-bold tracking-tight text-text-primary">NV Med</span>
                <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">Gestão médica</span>
              </span>
            )}
          </Link>
        </div>

        <div className="relative border-b border-sidebar-border p-2.5">
          <button
            type="button"
            onClick={() => currentUser.type === 'saas_admin' && setOrgMenuOpen((open) => !open)}
            className={`group/org relative flex w-full items-center rounded-xl text-left text-text-secondary transition hover:bg-state-hover hover:text-text-primary ${sidebarCollapsed ? 'h-11 justify-center px-2' : 'gap-2.5 px-2.5 py-2'}`}
            aria-label={`Empresa ativa: ${activeOrg?.name || 'nenhuma'}`}
          >
            <Building2 className="h-[18px] w-[18px] shrink-0 text-primary" />
            {sidebarCollapsed && <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-text-primary opacity-0 shadow-medium transition group-hover/org:opacity-100">{activeOrg?.name || 'Empresa ativa'}</span>}
            {!sidebarCollapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] font-semibold uppercase tracking-wider text-text-muted">Empresa ativa</span>
                  <span className="block truncate text-xs font-semibold">{activeOrg?.name || 'Sem empresa'}</span>
                </span>
                {currentUser.type === 'saas_admin' && <ChevronDown className="h-4 w-4 text-text-muted" />}
              </>
            )}
          </button>

          {orgMenuOpen && !sidebarCollapsed && currentUser.type === 'saas_admin' && (
            <div className="absolute left-2.5 right-2.5 top-[calc(100%-4px)] z-40 rounded-xl border border-border bg-surface-elevated p-1.5 shadow-strong">
              {organizations.map((org) => (
                <button
                  type="button"
                  key={org.id}
                  onClick={() => switchOrganization(org.id)}
                  className={`w-full truncate rounded-lg px-3 py-2 text-left text-xs font-medium transition hover:bg-state-hover ${org.id === activeOrganizationId ? 'text-primary' : 'text-text-secondary'}`}
                >
                  {org.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 px-2.5 py-4" aria-label="Navegação principal">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex h-11 items-center rounded-xl text-sm font-medium transition ${sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'} ${active ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-state-hover hover:text-text-primary'}`}
              >
                {active && <span className="absolute -left-2.5 h-5 w-0.5 rounded-r-full bg-primary" />}
                <Icon className={`h-[19px] w-[19px] shrink-0 ${active ? 'text-primary' : 'text-text-muted group-hover:text-text-primary'}`} />
                {!sidebarCollapsed && <span className="truncate">{item.name}</span>}
                {sidebarCollapsed && <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-text-primary opacity-0 shadow-medium transition duration-150 group-hover:opacity-100">{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2.5">
          <Link
            href="/perfil"
            className={`group/profile relative flex items-center rounded-xl transition hover:bg-state-hover ${sidebarCollapsed ? 'h-11 justify-center' : 'gap-2.5 p-2'}`}
          >
            <UserAvatar name={currentUser.name} src={currentUser.avatar} className="h-8 w-8" />
            {sidebarCollapsed && <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-text-primary opacity-0 shadow-medium transition group-hover/profile:opacity-100">Meu perfil</span>}
            {!sidebarCollapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-text-primary">{currentUser.name}</span>
                <span className="block truncate text-[10px] text-text-muted">Meu perfil</span>
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`group/toggle relative mt-1 flex h-9 w-full items-center rounded-lg text-xs font-medium text-text-muted transition hover:bg-state-hover hover:text-text-primary ${sidebarCollapsed ? 'justify-center' : 'gap-2.5 px-2.5'}`}
            aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!sidebarCollapsed && 'Recolher menu'}
            {sidebarCollapsed && <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-medium text-text-primary opacity-0 shadow-medium transition group-hover/toggle:opacity-100">Expandir menu</span>}
          </button>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[68px] items-center justify-around border-t border-sidebar-border bg-sidebar-bg/96 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Navegação móvel">
        {items.slice(0, 3).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={`flex min-w-14 flex-col items-center gap-1 py-2 text-[10px] font-medium ${active ? 'text-primary' : 'text-text-muted'}`}>
              <Icon className="h-5 w-5" />
              <span>{item.shortName}</span>
            </Link>
          );
        })}
        <div className="relative">
          <button type="button" onClick={() => setMobileMoreOpen((open) => !open)} className={`flex min-w-14 flex-col items-center gap-1 py-2 text-[10px] font-medium ${items.slice(3).some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ? 'text-primary' : 'text-text-muted'}`} aria-expanded={mobileMoreOpen}>
            <MoreHorizontal className="h-5 w-5" />
            <span>Mais</span>
          </button>
          {mobileMoreOpen && (
            <div className="absolute bottom-14 left-1/2 w-52 -translate-x-1/2 rounded-2xl border border-border bg-surface-elevated p-2 shadow-strong">
              {items.slice(3).map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileMoreOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-state-hover hover:text-text-primary">
                    <Icon className="h-4 w-4 text-text-muted" /> {item.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <Link href="/perfil" aria-current={pathname.startsWith('/perfil') ? 'page' : undefined} className={`flex min-w-14 flex-col items-center gap-1 py-2 text-[10px] font-medium ${pathname.startsWith('/perfil') ? 'text-primary' : 'text-text-muted'}`}>
          <UserAvatar name={currentUser.name} src={currentUser.avatar} className="h-5 w-5" />
          <span>Perfil</span>
        </Link>
      </nav>
    </>
  );
}
