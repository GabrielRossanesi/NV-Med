'use client';

import { useStore } from '@/store/useStore';
import { Bell, ShieldAlert, Sparkles, Building } from 'lucide-react';
import Link from 'next/link';

export default function Header() {
  const { activeOrganizationId, organizations, documents } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  
  // Calculate document alerts for active organization
  const activeOrgDocs = documents.filter((d) => d.organizationId === activeOrganizationId);
  const pendingOrAlertDocs = activeOrgDocs.filter(
    (d) => d.status === 'analyzing' || d.status === 'expired' || d.status === 'rejected'
  ).length;

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-6 md:px-8">
      {/* Left side: Breadcrumb / Active Company indicator */}
      <div className="flex items-center gap-3">
        <div className="md:hidden flex items-center gap-1.5 bg-teal-500/10 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded text-xs font-semibold">
          <Building className="h-3 w-3" />
          <span>{activeOrg?.name}</span>
        </div>
        <div className="hidden md:flex items-center gap-2">
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-900/30 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-teal-500 animate-pulse" />
            Empresa: {activeOrg?.name}
          </span>
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
            Demo Mode
          </span>
        </div>
      </div>

      {/* Right side: Alert indicators + Profile shortcut */}
      <div className="flex items-center gap-4">
        {pendingOrAlertDocs > 0 && (
          <Link
            href="/documentos"
            className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2.5 py-1 rounded-full text-xs font-medium border border-amber-100 dark:border-amber-900/30 animate-pulse"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Pendências:</span>
            <span className="font-bold">{pendingOrAlertDocs}</span>
          </Link>
        )}

        {/* Notification Bell */}
        <button className="relative p-1.5 rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
          <Bell className="h-4 w-4" />
          {pendingOrAlertDocs > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-teal-500 ring-2 ring-white dark:ring-slate-900" />
          )}
        </button>

        {/* Demo User Name (visible on desktop) */}
        <div className="hidden sm:flex items-center gap-2 border-l border-slate-200 dark:border-slate-800 pl-4">
          <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-400">
            GM
          </div>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Gabriel M.</span>
        </div>
      </div>
    </header>
  );
}
