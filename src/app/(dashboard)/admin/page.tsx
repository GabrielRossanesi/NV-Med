'use client';
import { useStore } from '@/store/useStore';
import StorageUsagePanel from '@/components/StorageUsagePanel';
import AccessGuard from '@/components/AccessGuard';
import Link from 'next/link';
import { workspaceTotal } from '@/lib/workspaceScope';
export default function AdminPage() {
  const {organizations, organizationCounts} = useStore();
  return <AccessGuard requiredPermission="admin"><div className="space-y-7"><header><h1 className="text-2xl font-semibold">Painel SaaS</h1></header><StorageUsagePanel/><div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[['Empresas',organizations.length],['Médicos',workspaceTotal(organizationCounts,'doctors')??'—'],['Unidades',workspaceTotal(organizationCounts,'units')??'—'],['Plantões',workspaceTotal(organizationCounts,'shifts')??'—']].map(([label,count])=><div key={label} className="p-5 bg-card-bg border border-border rounded-xl"><p className="text-sm text-text-secondary">{label}</p><p className="text-3xl font-semibold mt-2">{count}</p></div>)}</div><section className="bg-card-bg border border-border rounded-xl p-5"><div className="flex flex-wrap items-center justify-between gap-3 mb-5"><h2 className="font-semibold">Empresas</h2><Link href="/admin/empresas" className="nv-button-secondary">Gerenciar empresas</Link></div><ul className="divide-y divide-border">{organizations.map(o=><li key={o.id} className="py-4 flex justify-between gap-4"><div><p className="font-medium text-sm">{o.name}</p><p className="text-xs text-text-secondary mt-1">{organizationCounts[o.id]?.accounts??'—'} acessos vinculados</p></div><Link href="/escala" onClick={()=>useStore.getState().setActiveOrganizationId(o.id)} className="text-sm text-primary">Abrir escala →</Link></li>)}</ul>{!organizations.length && <p className="text-sm text-text-secondary">Cadastre a primeira empresa para organizar a operação.</p>}</section><Link href="/admin/usuarios" className="nv-button">Gerenciar acessos</Link></div></AccessGuard>;
}
