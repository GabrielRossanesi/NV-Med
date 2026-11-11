'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardList, LoaderCircle, LogOut, Moon, MoreHorizontal, Sun, Users, type LucideIcon } from 'lucide-react';
import { canPerformAction, canViewPermission } from '@/lib/permissions';
import { useStore } from '@/store/useStore';
import UserAvatar from './UserAvatar';
import { useLocationHash } from './useLocationHash';

type Item = { name: string; shortName: string; href: string; icon: LucideIcon };

export default function MobileStaffNavigation({ items, activeHref, pathname, onLogout, logoutPending, logoutError }: {
  items: Item[];
  activeHref: string;
  pathname: string;
  onLogout: () => Promise<void>;
  logoutPending: boolean;
  logoutError: string;
}) {
  const currentUser = useStore(state => state.currentUser);
  const isSimulating = useStore(state => state.isSimulating);
  const theme = useStore(state => state.theme);
  const setTheme = useStore(state => state.setTheme);
  const hash = useLocationHash();
  const [open, setOpen] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const authorized = [...items];
  if (currentUser.type === 'tenant_user' && canViewPermission(currentUser, 'usuarios')) {
    authorized.push({ name: 'Usuários da empresa', shortName: 'Usuários', href: '/admin/usuarios', icon: Users });
  }
  if (canViewPermission(currentUser, 'dashboard')) {
    authorized.push({ name: 'Pendências', shortName: 'Pendências', href: '/dashboard#pendencias', icon: ClipboardList });
  }
  const current = pathname.startsWith('/perfil') ? '/perfil'
    : pathname === '/dashboard' && hash === '#pendencias' ? '/dashboard#pendencias'
      : activeHref || authorized.find(item => item.href === pathname)?.href;
  const financeRole = currentUser.role === 'Financeiro';
  const operational = financeRole
    ? ['/dashboard', '/financeiro', '/relatorios', '/escala']
    : ['/dashboard', '/escala', '/dashboard#pendencias', '/documentos', '/relatorios'];
  const administersSaas = currentUser.type === 'saas_admin' && !isSimulating
    && ['CEO', 'Gerente', 'Administrativo'].includes(currentUser.role);
  const priority = administersSaas
    ? ['/dashboard', '/admin/empresas', '/admin/usuarios', ...operational]
    : canPerformAction(currentUser, 'escala', 'approve') || financeRole
      ? operational
      : ['/dashboard', '/escala', '/documentos', '/dashboard#pendencias', '/relatorios'];
  const ranked = priority.flatMap(href => authorized.filter(item => item.href === href));
  const primary = [...new Map([...ranked, ...authorized].map(item => [item.href, item])).values()].slice(0, 3);
  const extra = authorized.filter(item => !primary.some(link => link.href === item.href));
  const moreActive = current === '/perfil' || extra.some(item => item.href === current);

  useEffect(() => {
    if (!open) return;
    const first = sheet.current?.querySelector<HTMLElement>('a, button');
    first?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!region.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  function renderLink(item: Item, inSheet: boolean) {
    const active = current === item.href;
    const Icon = item.icon;
    const className = inSheet
      ? `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-state-hover ${active ? 'bg-state-selected text-primary' : 'text-text-secondary'}`
      : 'nv-mobile-link';
    const content = <><Icon size={inSheet ? 17 : 20} aria-hidden="true" className="shrink-0"/><span className={inSheet ? 'flex-1' : undefined}>{inSheet ? item.name : item.shortName}</span>{inSheet && active && <Check size={15} aria-hidden="true"/>}</>;
    return pathname === '/dashboard' && item.href === '/dashboard#pendencias'
      ? <a key={item.href} href="#pendencias" className={className} aria-current={active ? 'location' : undefined} onClick={() => setOpen(false)}>{content}</a>
      : <Link key={item.href} href={item.href} className={className} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}>{content}</Link>;
  }

  return <div ref={region} className="md:hidden">
    <nav className="nv-mobile-bar" aria-label="Navegação móvel">
      {primary.map(item => renderLink(item, false))}
      <button ref={trigger} type="button" className="nv-mobile-link" data-active={open ? '' : undefined} aria-current={moreActive ? 'location' : undefined}
        onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={open ? 'mobile-more-navigation' : undefined}>
        <MoreHorizontal size={20} aria-hidden="true"/><span>Mais</span>
      </button>
    </nav>
    {open && <div ref={sheet} id="mobile-more-navigation" className="nv-mobile-sheet" role="region" aria-label="Mais páginas e opções">
      {extra.length > 0 && <nav aria-label="Outras páginas">{extra.map(item => renderLink(item, true))}</nav>}
      <div className={extra.length ? 'mt-1 border-t border-border pt-1' : undefined}>
        <Link href="/perfil" aria-current={current === '/perfil' ? 'page' : undefined} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-state-hover">
          <UserAvatar name={currentUser.name} src={currentUser.avatar} className="size-6"/> Meu perfil
        </Link>
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-state-hover">
          {theme === 'dark' ? <Sun size={18} aria-hidden="true"/> : <Moon size={18} aria-hidden="true"/>}
          {theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
        </button>
        <button type="button" disabled={logoutPending} onClick={onLogout} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-60">
          {logoutPending ? <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true"/> : <LogOut size={18} aria-hidden="true"/>}
          {logoutPending ? 'Saindo…' : 'Sair da conta'}
        </button>
        {logoutError && <p role="alert" className="px-3 py-2 text-xs text-danger">{logoutError}</p>}
      </div>
    </div>}
  </div>;
}
