'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  Building,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  FileSpreadsheet,
  LoaderCircle,
  LogOut,
  Settings,
  Shield,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { canViewPermission } from '@/lib/permissions';
import { logoutCurrentSession } from '@/lib/auth/logout';
import UserAvatar from './UserAvatar';
import styles from './DashboardNavigation.module.css';

const operationalItems = [
  { name: 'Dashboard', shortName: 'Início', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard' },
  { name: 'Médicos', shortName: 'Médicos', href: '/medicos', icon: Users, permission: 'medicos' },
  { name: 'Escalas', shortName: 'Escalas', href: '/escala', icon: CalendarDays, permission: 'escala' },
  { name: 'Unidades', shortName: 'Unidades', href: '/unidades', icon: Building2, permission: 'unidades' },
  { name: 'Documentos', shortName: 'Docs', href: '/documentos', icon: FileText, permission: 'documentos' },
  { name: 'Financeiro', shortName: 'Financeiro', href: '/financeiro', icon: WalletCards, permission: 'financeiro' },
  { name: 'Relatórios', shortName: 'Relatórios', href: '/relatorios', icon: FileSpreadsheet, permission: 'relatorios' },
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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const organizationMenu = useRef<HTMLDivElement>(null);
  const profileMenu = useRef<HTMLDivElement>(null);
  const mobileMenu = useRef<HTMLDivElement>(null);
  const organizationTrigger = useRef<HTMLButtonElement>(null);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const activeLink = useRef<HTMLAnchorElement>(null);
  const reduceMotion = useReducedMotion();
  const {
    activeOrganizationId,
    organizations,
    setActiveOrganizationId,
    currentUser,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useStore();

  const activeOrg = organizations.find((org) => org.id === activeOrganizationId) || organizations[0];
  const items = [
    ...(currentUser.type === 'saas_admin' ? adminItems : []),
    ...operationalItems,
  ].filter((item) => canViewPermission(currentUser, item.permission));
  // Only the most specific route is active (e.g. /admin/usuarios, not /admin as well).
  const activeHref = items.reduce((selected, item) =>
    (pathname === item.href || pathname.startsWith(`${item.href}/`)) && item.href.length > selected.length
      ? item.href : selected, '');
  const groups = [
    { label: 'Administração', items: items.filter((item) => item.href.startsWith('/admin')) },
    { label: 'Operação', items: items.filter((item) => !item.href.startsWith('/admin')) },
  ].filter((group) => group.items.length > 0);

  const showTooltip = (label: string, element: HTMLElement) => {
    if (!sidebarCollapsed) return;
    const bounds = element.getBoundingClientRect();
    setTooltip({ label, top: bounds.top + bounds.height / 2, left: bounds.right + 12 });
  };
  const closeMenus = () => {
    setOrgMenuOpen(false);
    setProfileMenuOpen(false);
    setMobileMoreOpen(false);
    setTooltip(null);
  };

  const switchOrganization = (organizationId: string) => {
    setActiveOrganizationId(organizationId);
    setOrgMenuOpen(false);
    router.refresh();
  };

  useEffect(() => {
    const nav = navigation.current;
    const link = activeLink.current;
    if (!nav || !link) return;
    const bounds = nav.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    if (item.top < bounds.top + 16) nav.scrollTop -= bounds.top + 16 - item.top;
    else if (item.bottom > bounds.bottom - 16) nav.scrollTop += item.bottom - bounds.bottom + 16;
  }, [activeHref]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!profileMenu.current?.contains(event.target as Node)) setProfileMenuOpen(false);
      if (!organizationMenu.current?.contains(event.target as Node)) setOrgMenuOpen(false);
      if (!mobileMenu.current?.contains(event.target as Node)) setMobileMoreOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (profileMenuOpen) profileTrigger.current?.focus();
      else if (orgMenuOpen) organizationTrigger.current?.focus();
      else if (mobileMoreOpen) mobileTrigger.current?.focus();
      setProfileMenuOpen(false);
      setOrgMenuOpen(false);
      setMobileMoreOpen(false);
      setTooltip(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [profileMenuOpen, orgMenuOpen, mobileMoreOpen]);

  const logout = async () => {
    setLogoutPending(true);
    setLogoutError('');
    try {
      await logoutCurrentSession();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Não foi possível sair da conta.');
      setLogoutPending(false);
    }
  };

  return (
    <>
      <motion.aside layoutRoot className={styles.sidebar} data-collapsed={sidebarCollapsed} aria-label="Menu do NV Med">
        <div className={styles.brand}>
          <Link href="/dashboard" onNavigate={closeMenus} className={styles.brandLink} aria-label="NV Med — início">
            <span className={styles.brandMark}>
              <Activity className="h-[18px] w-[18px]" />
            </span>
            <span className={styles.brandCopy} aria-hidden={sidebarCollapsed}>
              <strong>NV Med</strong>
              <small>Gestão médica</small>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => { closeMenus(); setSidebarCollapsed(!sidebarCollapsed); }}
            className={styles.toggle}
            aria-label={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!sidebarCollapsed}
            aria-controls="desktop-navigation"
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </button>
        </div>

        <div ref={organizationMenu} className={styles.organization}>
          {currentUser.type === 'saas_admin' ? (
            <button
              ref={organizationTrigger}
              type="button"
              onClick={() => { setOrgMenuOpen((open) => !open); setProfileMenuOpen(false); setTooltip(null); }}
              onMouseEnter={(event) => showTooltip(activeOrg?.name || 'Selecionar empresa', event.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={(event) => showTooltip(activeOrg?.name || 'Selecionar empresa', event.currentTarget)}
              onBlur={() => setTooltip(null)}
              className={styles.organizationControl}
              aria-label={`Selecionar empresa. Empresa ativa: ${activeOrg?.name || 'nenhuma'}`}
              aria-expanded={orgMenuOpen}
              aria-controls="sidebar-organization-list"
            >
              <Building2 className="h-[18px] w-[18px] shrink-0 text-primary" />
              {!sidebarCollapsed && <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[9px] font-semibold uppercase tracking-wider text-text-muted">Empresa ativa</span>
                  <span className="block truncate text-xs font-semibold">{activeOrg?.name || 'Sem empresa'}</span>
                </span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${orgMenuOpen ? 'rotate-180' : ''}`} />
              </>}
            </button>
          ) : (
            <div className={styles.organizationControl} title={activeOrg?.name || 'Sem empresa'} aria-label={`Empresa ativa: ${activeOrg?.name || 'nenhuma'}`}>
              <Building2 className="h-[18px] w-[18px] shrink-0 text-primary" />
              {!sidebarCollapsed && <span className="min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-wider text-text-muted">Empresa ativa</span>
                <span className="block truncate text-xs font-semibold">{activeOrg?.name || 'Sem empresa'}</span>
              </span>}
            </div>
          )}

          {orgMenuOpen && currentUser.type === 'saas_admin' && (
            <div id="sidebar-organization-list" className={styles.organizationMenu}>
              <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Selecionar empresa</p>
              {organizations.map((org) => (
                <button
                  type="button"
                  key={org.id}
                  onClick={() => switchOrganization(org.id)}
                  aria-pressed={org.id === activeOrg?.id}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition hover:bg-state-hover ${org.id === activeOrg?.id ? 'bg-state-selected text-primary' : 'text-text-secondary'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {org.id === activeOrg?.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <LayoutGroup id="nv-med-sidebar">
          <motion.nav layoutScroll ref={navigation} id="desktop-navigation" className={styles.navigation} aria-label="Navegação principal" onScroll={() => setTooltip(null)}>
            {groups.map((group) => (
              <div key={group.label} className={styles.navigationGroup}>
                <p className={styles.groupLabel} aria-hidden={sidebarCollapsed}>{group.label}</p>
                {group.items.map((item) => {
                  const active = activeHref === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      ref={active ? activeLink : undefined}
                      href={item.href}
                      onNavigate={closeMenus}
                      aria-label={item.name}
                      aria-current={active ? 'page' : undefined}
                      onMouseEnter={(event) => showTooltip(item.name, event.currentTarget)}
                      onMouseLeave={() => setTooltip(null)}
                      onFocus={(event) => showTooltip(item.name, event.currentTarget)}
                      onBlur={() => setTooltip(null)}
                      className={styles.navItem}
                    >
                      {active && <motion.span
                        layoutId="active-navigation"
                        className={styles.activeIndicator}
                        aria-hidden="true"
                        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }}
                      />}
                      <Icon className={`${styles.navIcon} h-[19px] w-[19px]`} aria-hidden="true" />
                      <span className={styles.navLabel} aria-hidden={sidebarCollapsed}>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </motion.nav>
        </LayoutGroup>

        <div className={styles.footer}>
          <div ref={profileMenu} className="relative">
            <button
              ref={profileTrigger}
              type="button"
              onClick={() => { setProfileMenuOpen((open) => !open); setOrgMenuOpen(false); setLogoutError(''); setTooltip(null); }}
              onMouseEnter={(event) => showTooltip('Abrir perfil', event.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={(event) => showTooltip('Abrir perfil', event.currentTarget)}
              onBlur={() => setTooltip(null)}
              className={`group/profile relative flex w-full items-center rounded-xl text-left transition hover:bg-state-hover ${sidebarCollapsed ? 'h-11 justify-center' : 'gap-2.5 p-2'}`}
              aria-label="Abrir menu do perfil"
              aria-expanded={profileMenuOpen}
              aria-controls="sidebar-profile-menu"
            >
              <UserAvatar name={currentUser.name} src={currentUser.avatar} className="h-8 w-8" />
              {!sidebarCollapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-text-primary">{currentUser.name}</span>
                    <span className="block truncate text-[10px] text-text-muted">Conta e perfil</span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 text-text-muted transition-transform duration-150 ${profileMenuOpen ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>

            {profileMenuOpen && (
              <div id="sidebar-profile-menu" className={`absolute bottom-[calc(100%+0.5rem)] z-50 w-64 rounded-2xl border border-border bg-surface-elevated p-2 shadow-strong ${sidebarCollapsed ? 'left-full ml-3' : 'left-0'}`}>
                <div className="border-b border-border px-2 pb-2.5 pt-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{currentUser.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">{currentUser.email}</p>
                </div>
                <Link href="/perfil" onNavigate={closeMenus} className="mt-1 flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition hover:bg-state-hover hover:text-text-primary">
                  <UserRound className="h-4 w-4" /> Meu perfil
                </Link>
                <button type="button" onClick={logout} disabled={logoutPending} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-danger transition hover:bg-danger/10 disabled:cursor-wait disabled:opacity-60">
                  {logoutPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} {logoutPending ? 'Saindo…' : 'Sair da conta'}
                </button>
                {logoutError && <p role="alert" className="px-3 pb-1 pt-2 text-xs leading-relaxed text-danger">{logoutError}</p>}
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(68px+env(safe-area-inset-bottom))] items-center justify-around border-t border-sidebar-border bg-sidebar-bg/96 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Navegação móvel">
        {items.slice(0, 3).map((item) => {
          const active = activeHref === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} onNavigate={closeMenus} aria-current={active ? 'page' : undefined} className={`flex min-h-11 min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium transition ${active ? 'bg-state-selected text-primary' : 'text-text-muted hover:bg-state-hover'}`}>
              <Icon className="h-5 w-5" />
              <span>{item.shortName}</span>
            </Link>
          );
        })}
        {items.length > 3 && <div ref={mobileMenu} className="relative">
          <button ref={mobileTrigger} type="button" onClick={() => setMobileMoreOpen((open) => !open)} className={`flex min-h-11 min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium transition hover:bg-state-hover ${mobileMoreOpen || items.slice(3).some((item) => activeHref === item.href) ? 'bg-state-selected text-primary' : 'text-text-muted'}`} aria-label="Mais páginas" aria-expanded={mobileMoreOpen} aria-controls="mobile-more-navigation">
            <MoreHorizontal className="h-5 w-5" />
            <span>Mais</span>
          </button>
          {mobileMoreOpen && (
            <motion.div id="mobile-more-navigation" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] max-h-[calc(100svh-100px-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface-elevated p-2 shadow-strong">
              <p className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Navegação</p>
              {items.slice(3).map((item) => {
                const Icon = item.icon;
                const active = activeHref === item.href;
                return (
                  <Link key={item.href} href={item.href} onNavigate={closeMenus} aria-current={active ? 'page' : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-state-hover ${active ? 'bg-state-selected text-primary' : 'text-text-secondary'}`}>
                    <Icon className="h-4 w-4 shrink-0" /> <span className="flex-1">{item.name}</span>{active && <Check className="h-4 w-4" />}
                  </Link>
                );
              })}
            </motion.div>
          )}
        </div>}
        <Link href="/perfil" onNavigate={closeMenus} aria-current={pathname.startsWith('/perfil') ? 'page' : undefined} className={`flex min-h-11 min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium transition hover:bg-state-hover ${pathname.startsWith('/perfil') ? 'bg-state-selected text-primary' : 'text-text-muted'}`}>
          <UserAvatar name={currentUser.name} src={currentUser.avatar} className="h-5 w-5" />
          <span>Perfil</span>
        </Link>
      </nav>
      {sidebarCollapsed && tooltip && createPortal(
        <span role="tooltip" className={styles.tooltip} style={{ top: tooltip.top, left: tooltip.left }}>{tooltip.label}</span>,
        document.body,
      )}
    </>
  );
}
