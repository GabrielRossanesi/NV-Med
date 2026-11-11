'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronDown, EyeOff, LoaderCircle, LogOut, Moon, Search, Sun, UserRound } from 'lucide-react';
import { logoutCurrentSession } from '@/lib/auth/logout';
import { doctorsWithDocumentIssues } from '@/lib/dashboardOverview';
import { getDocumentGovernance } from '@/lib/documentGovernance';
import { canViewPermission } from '@/lib/permissions';
import { useStore } from '@/store/useStore';
import DashboardSearch from './DashboardSearch';
import NotificationInbox from './NotificationInbox';
import SaveFeedback from './SaveFeedback';
import UserAvatar from './UserAvatar';

const actions = 'grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-text-secondary transition-colors hover:bg-state-hover hover:text-primary';
const navigation = [
  { label: 'Visão geral', href: '/dashboard', permission: 'dashboard' },
  { label: 'Escalas', href: '/escala', permission: 'escala' },
  { label: 'Pendências', href: '/dashboard#pendencias', permission: 'dashboard' },
  { label: 'Relatórios', href: '/relatorios', permission: 'relatorios' },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [referenceTime] = useState(Date.now);
  const profileMenu = useRef<HTMLDivElement>(null);
  const profileTrigger = useRef<HTMLButtonElement>(null);
  const { activeOrganizationId, organizations, setActiveOrganizationId, theme, setTheme, currentUser, isSimulating, stopSimulation, doctors, documents, shifts } = useStore();

  const activeOrg = organizations.find(organization => organization.id === activeOrganizationId);
  const canSwitch = currentUser.type === 'saas_admin' && organizations.length > 1;
  const showSearch = ['medicos', 'unidades', 'escala'].some(permission => canViewPermission(currentUser, permission));
  const canSeeDocuments = canViewPermission(currentUser, 'documentos');
  const documentAlerts = useMemo(() => {
    const governance = getDocumentGovernance(activeOrg);
    if (!canSeeDocuments || !activeOrg || !governance.internalNotifications) return 0;
    return doctorsWithDocumentIssues(
      doctors.filter(doctor => doctor.organizationId === activeOrganizationId),
      documents.filter(document => document.organizationId === activeOrganizationId),
      shifts.filter(shift => shift.organizationId === activeOrganizationId),
      referenceTime, activeOrg.settings.requiredDocuments, Math.max(...governance.expiryAlertDays),
    ).length;
  }, [activeOrg, activeOrganizationId, canSeeDocuments, doctors, documents, referenceTime, shifts]);

  useEffect(() => {
    if (!profileOpen) return;
    const close = (event: PointerEvent) => {
      if (!profileMenu.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProfileOpen(false);
      profileTrigger.current?.focus();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [profileOpen]);

  async function logout() {
    setLogoutPending(true);
    setLogoutError('');
    try {
      await logoutCurrentSession();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Não foi possível sair da conta.');
      setLogoutPending(false);
    }
  }

  return (
    <header className="nv-topbar sticky top-0 z-20 bg-background/95 backdrop-blur-md">
      <div className="nv-topbar-inner mx-auto w-full max-w-[112rem] px-3 py-2.5 sm:px-6 xl:px-9">
        <div className="nv-topbar-context flex min-w-0 items-center gap-2.5 max-md:gap-2">
          <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary min-[390px]:grid max-md:size-8" aria-hidden="true">
            <Building2 size={18} />
          </span>
          <div className="min-w-0 max-md:flex-1">
            <p className="truncate text-[11px] font-medium text-text-muted">{currentUser.type === 'saas_admin' && !isSimulating ? 'Administração SaaS' : 'Operação médica'}</p>
            {canSwitch ? (
              <div className="relative flex min-w-0 items-center gap-0.5">
                <select aria-label="Empresa ativa" value={activeOrganizationId} title={activeOrg?.name}
                  onChange={event => { setActiveOrganizationId(event.target.value); router.refresh(); }}
                  className="min-h-6 min-w-0 max-w-full cursor-pointer appearance-none truncate rounded-sm pr-4 text-xs font-semibold text-text-primary sm:text-sm max-md:w-full">
                  {organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                </select>
                <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-0 text-text-muted" />
              </div>
            ) : <p title={activeOrg?.name} className="truncate text-xs font-semibold text-text-primary sm:text-sm">{activeOrg?.name || 'NV Med'}</p>}
          </div>
        </div>

        <nav aria-label="Atalhos da operação" className="nv-topbar-nav flex w-fit max-w-full items-center gap-0.5 rounded-[1.25rem] border border-border bg-surface p-1 shadow-soft">
          {navigation.filter(item => canViewPermission(currentUser, item.permission)).map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const className = `inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full px-1.5 text-xs font-semibold transition-colors min-[390px]:px-2.5 sm:px-3.5 ${active ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-state-hover hover:text-primary'}`;
            if (pathname === '/dashboard' && item.href === '/dashboard#pendencias') {
              return <a key={item.href} href="#pendencias" className={className}>{item.label}</a>;
            }
            return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
              className={className}>
              {item.label}
            </Link>;
          })}
        </nav>

        <div className="nv-topbar-actions flex items-center rounded-full border border-border bg-surface p-0.5 shadow-soft sm:gap-0.5 sm:p-1">
          {showSearch && <button type="button" className={actions} aria-label="Pesquisar na empresa" aria-haspopup="dialog" title="Pesquisar na empresa" onClick={() => setSearchOpen(true)}><Search size={18} aria-hidden="true" /></button>}
          <NotificationInbox key={currentUser.id} variant="header" documentAlerts={documentAlerts} />
          <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className={`${actions} nv-topbar-secondary`}
            aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} title={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}>
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
          <div ref={profileMenu} className="nv-topbar-secondary relative border-l border-border pl-0.5 sm:pl-1">
            <button ref={profileTrigger} type="button" onClick={() => { setProfileOpen(open => !open); setLogoutError(''); }}
              className="flex h-10 min-w-10 cursor-pointer items-center justify-center gap-1.5 rounded-full transition-colors hover:bg-state-hover sm:gap-2 sm:pl-1 sm:pr-2"
              aria-label={`Abrir menu do perfil de ${currentUser.name}`} aria-expanded={profileOpen} aria-controls={profileOpen ? 'header-profile-menu' : undefined}>
              <UserAvatar name={currentUser.name} src={currentUser.avatar} className="size-8" />
              <span className="hidden max-w-24 truncate text-xs font-semibold text-text-primary sm:block">{currentUser.name.split(' ')[0]}</span>
              <ChevronDown size={14} aria-hidden="true" className={`hidden text-text-muted transition-transform motion-reduce:transition-none sm:block ${profileOpen ? 'rotate-180' : ''}`} />
            </button>

            {profileOpen && (
              <div id="header-profile-menu" className="nv-topbar-popover absolute right-0 mt-3 w-64 rounded-2xl border border-border bg-surface-elevated p-2 shadow-strong">
                <div className="flex items-center gap-3 border-b border-border px-2 py-2.5">
                  <UserAvatar name={currentUser.name} src={currentUser.avatar} className="size-10" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{currentUser.name}</p>
                    <p className="truncate text-xs text-text-muted">{currentUser.email}</p>
                  </div>
                </div>
                <Link href="/perfil" onClick={() => setProfileOpen(false)} className="mt-1 flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm text-text-secondary transition-colors hover:bg-state-hover hover:text-text-primary">
                  <UserRound size={16} aria-hidden="true" /> Meu perfil
                </Link>
                <button type="button" onClick={logout} disabled={logoutPending} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm text-danger transition-colors hover:bg-danger/10 disabled:cursor-wait disabled:opacity-60">
                  {logoutPending ? <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />} {logoutPending ? 'Saindo…' : 'Sair da conta'}
                </button>
                {logoutError && <p role="alert" className="px-3 pb-1 pt-2 text-xs leading-relaxed text-danger">{logoutError}</p>}
              </div>
            )}
          </div>
        </div>

        {isSimulating && <div className="nv-topbar-simulation flex w-fit items-center gap-2 rounded-full bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning">
          <EyeOff size={15} aria-hidden="true" /> Visualizando empresa
          <button type="button" onClick={stopSimulation} className="underline underline-offset-2">Sair</button>
        </div>}
      </div>
      <SaveFeedback />
      {searchOpen && <DashboardSearch key={activeOrganizationId} onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
