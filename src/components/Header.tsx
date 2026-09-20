'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronDown, EyeOff, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/store/useStore';
import UserAvatar from './UserAvatar';

export default function Header() {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenu = useRef<HTMLDivElement>(null);
  const {
    activeOrganizationId,
    organizations,
    documents,
    theme,
    setTheme,
    currentUser,
    isSimulating,
    stopSimulation,
  } = useStore();

  const activeOrg = organizations.find((organization) => organization.id === activeOrganizationId) || organizations[0];
  const alerts = documents.filter((document) =>
    document.organizationId === activeOrganizationId && ['analyzing', 'expired', 'rejected'].includes(document.status)
  ).length;

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!profileMenu.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  const logout = async () => {
    await createClient()?.auth.signOut();
    useStore.getState().clearSession();
    window.location.replace('/login');
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-header-bg/88 px-4 backdrop-blur-xl md:px-7">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-text-muted">{currentUser.type === 'saas_admin' && !isSimulating ? 'Administração SaaS' : 'Operação médica'}</p>
        <p className="truncate text-sm font-semibold text-text-primary">{activeOrg?.name || 'NV Med'}</p>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {isSimulating && (
          <div className="mr-1 flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-1.5 text-xs font-semibold text-warning">
            <EyeOff className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Visualizando empresa</span>
            <button type="button" onClick={stopSimulation} className="underline underline-offset-2">Sair</button>
          </div>
        )}

        {alerts > 0 && (
          <Link href="/documentos" className="relative flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition hover:bg-state-hover hover:text-text-primary" aria-label={`${alerts} pendências documentais`}>
            <Bell className="h-[18px] w-[18px]" />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-header-bg" />
          </Link>
        )}

        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition hover:bg-state-hover hover:text-text-primary"
          aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        <div ref={profileMenu} className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            className="ml-1 flex items-center gap-2 rounded-xl py-1 pl-1 pr-1.5 transition hover:bg-state-hover"
            aria-expanded={profileOpen}
            aria-haspopup="menu"
          >
            <UserAvatar name={currentUser.name} src={currentUser.avatar} className="h-8 w-8" />
            <span className="hidden max-w-36 truncate text-xs font-semibold text-text-primary sm:block">{currentUser.name.split(' ')[0]}</span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-text-muted sm:block" />
          </button>

          {profileOpen && (
            <div role="menu" className="absolute right-0 mt-2 w-64 rounded-2xl border border-border bg-surface-elevated p-2 shadow-strong">
              <div className="flex items-center gap-3 border-b border-border px-2 py-2.5">
                <UserAvatar name={currentUser.name} src={currentUser.avatar} className="h-10 w-10" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">{currentUser.name}</p>
                  <p className="truncate text-[11px] text-text-muted">{currentUser.email}</p>
                </div>
              </div>
              <Link role="menuitem" href="/perfil" onClick={() => setProfileOpen(false)} className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition hover:bg-state-hover hover:text-text-primary">
                <UserRound className="h-4 w-4" /> Meu perfil
              </Link>
              <button role="menuitem" type="button" onClick={logout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-danger transition hover:bg-danger/10">
                <LogOut className="h-4 w-4" /> Sair da conta
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
