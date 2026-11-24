'use client';

import Link from 'next/link';
import { canPerformAction } from '@/lib/permissions';
import { useStore } from '@/store/useStore';

export default function BillingNav({ active }: { active: string }) {
  const currentUser = useStore(state => state.currentUser);
  const canViewBilling = canPerformAction(currentUser, 'financeiro', 'billing_view');
  const canViewRates = canPerformAction(currentUser, 'financeiro', 'rates_view');
  const links = [
    { id: 'overview', label: 'Visão geral', href: '/financeiro/empresa?aba=overview', show: canViewBilling },
    { id: 'payable', label: 'Contas a pagar', href: '/financeiro', show: true },
    { id: 'receivable', label: 'Contas a receber', href: '/financeiro/empresa?aba=receivable', show: canViewBilling },
    { id: 'billing', label: 'Faturamento', href: '/financeiro/empresa?aba=billing', show: canViewBilling },
    { id: 'rates', label: 'Valores contratuais', href: '/financeiro/empresa?aba=rates', show: canViewRates },
    { id: 'reports', label: 'Relatórios', href: '/financeiro/relatorio', show: true },
  ];
  return <nav aria-label="Financeiro" className="flex flex-wrap gap-1 border-b border-border">
    {links.filter(item => item.show).map(item => <Link key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined}
      className={'min-h-11 border-b-2 px-3 py-2.5 text-sm font-medium ' + (active === item.id
        ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-primary')}>{item.label}</Link>)}
  </nav>;
}
