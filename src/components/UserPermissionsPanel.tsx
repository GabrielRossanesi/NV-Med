'use client';

import { useState } from 'react';
import { ADDITIONAL_PERMISSION_MODULES, canPerformAction, permissionActionLabels, permissionDecision } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/client';
import type { AdditionalPermissions, UserAccount } from '@/types';

type Snapshot = { role: string; status: string; permissions: AdditionalPermissions; delegations: string[] };
type Audit = { id: number; actor_name: string | null; created_at: string; reason: string | null; previous: Snapshot | null; next: Snapshot };
type Props = {
  user: UserAccount | null; actor: UserAccount; role: string; permissions: AdditionalPermissions;
  onChange: (value: AdditionalPermissions) => void;
  delegations: string[]; onDelegationsChange: (value: string[]) => void;
};

function changes({ previous, next }: Audit) {
  const result: string[] = [];
  if (!previous) result.push(`Acesso criado como ${next.role}`);
  if (previous?.role && previous.role !== next.role) result.push(`Cargo: ${previous.role} → ${next.role}`);
  const status: Record<string, string> = { active: 'Ativo', inactive: 'Inativo', pending: 'Pendente' };
  if (previous && previous.status !== next.status) result.push(`Situação: ${status[previous.status]} → ${status[next.status]}`);
  const options = { allow: 'Permitido', deny: 'Negado', view: 'Somente leitura', edit: 'Leitura e edição' };
  for (const group of ADDITIONAL_PERMISSION_MODULES) {
    for (const action of ['', ...group.actions] as const) {
      const key = action ? `${group.key}.${action}` : group.key;
      const before = previous?.permissions[key];
      const after = next.permissions[key];
      const label = action ? `${group.label} · ${permissionActionLabels[action]}` : group.label;
      if (before !== after) result.push(`${label}: ${before ? options[before] : 'Herdar'} → ${after ? options[after] : 'Herdar'}`);
      if (action && Boolean(previous?.delegations.includes(key)) !== next.delegations.includes(key)) {
        result.push(`${label}: delegação ${next.delegations.includes(key) ? 'habilitada' : 'revogada'}`);
      }
    }
  }
  return result;
}

export default function UserPermissionsPanel({ user, actor, role, permissions, onChange, delegations, onDelegationsChange }: Props) {
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [auditError, setAuditError] = useState(false);
  const [loading, setLoading] = useState(false);
  const isSaas = actor.type === 'saas_admin';
  const profile = { type: 'tenant_user' as const, role, additionalPermissions: permissions };
  const manager = ['Diretor', 'Gerente'].includes(role);

  async function loadHistory() {
    setLoading(true);
    setAuditError(false);
    try {
      const response = await createClient()?.rpc('nv_user_permission_history', { target: user?.id });
      if (!response || response.error) throw new Error('Histórico indisponível.');
      setAudit(response.data);
    } catch { setAuditError(true); }
    finally { setLoading(false); }
  }

  return <section aria-label="Permissões individuais" className="overflow-hidden rounded-xl border border-border">
    <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-muted/40 px-4 py-3">
      <div><h3 className="text-sm font-semibold">Permissões individuais</h3><p className="mt-1 text-xs text-text-muted">Veja a origem do acesso e ajuste as exceções por ação.</p></div>
      {isSaas && Object.keys(permissions).length > 0 && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onChange({})}>Restaurar padrão do cargo</button>}
    </div>
    {ADDITIONAL_PERMISSION_MODULES.map(module => <details key={module.key} className="border-t border-border px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">{module.label}<span className="ml-2 text-xs font-normal text-text-muted">{module.actions.filter(action => permissionDecision(profile, module.key, action).allowed).length} de {module.actions.length} ações permitidas</span></summary>
      <div className="mt-3 divide-y divide-border">
        {module.actions.map(action => {
          const key = `${module.key}.${action}`;
          const decision = permissionDecision(profile, module.key, action);
          const canGrant = action === 'view' || ((module.key !== 'usuarios' || manager) && permissionDecision(profile, module.key, 'view').allowed);
          const canDeny = action !== 'view' || !module.actions.some(item => item !== 'view' && permissions[`${module.key}.${item}`] === 'allow');
          const locked = !isSaas && (user?.permissionLocks?.includes(key) || user?.permissionLocks?.includes(module.key) || !actor.delegatedPermissions?.includes(key)
            || !canPerformAction(actor, module.key, action) || module.key === 'usuarios');
          return <div key={key} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center">
            <div><p className="text-sm font-medium">{permissionActionLabels[action]}</p><p className="text-xs text-text-muted">{decision.origin}{user?.permissionLocks?.includes(key) ? ' · Definido pelo SaaS' : ''}</p></div>
            <select className="nv-input" aria-label={`${module.label}: ${permissionActionLabels[action]}`} disabled={locked} value={permissions[key] || ''} onChange={event => {
              const next = { ...permissions };
              const value = event.target.value;
              if (value === 'allow' || value === 'deny') next[key] = value;
              else delete next[key];
              onChange(next);
            }}>
              <option value="">Herdar</option><option value="allow" disabled={!canGrant}>Permitir</option><option value="deny" disabled={!canDeny}>Negar</option>
            </select>
            {isSaas && manager && module.key !== 'usuarios' && <label className="flex items-center gap-2 text-xs text-text-muted sm:col-span-2">
              <input type="checkbox" checked={delegations.includes(key)} onChange={event => onDelegationsChange(event.target.checked ? [...delegations, key] : delegations.filter(item => item !== key))} /> Pode delegar esta ação
            </label>}
          </div>;
        })}
      </div>
    </details>)}
    {user && <div className="space-y-2 border-t border-border px-4 py-3">
      <button type="button" className="text-xs font-semibold text-primary hover:underline" disabled={loading} onClick={loadHistory}>{loading ? 'Carregando…' : 'Consultar histórico de permissões'}</button>
      {auditError && <p role="alert" className="text-xs text-danger">Não foi possível carregar o histórico.</p>}
      {audit && (audit.length ? <ul className="divide-y divide-border text-xs text-text-muted">{audit.map(item => <li key={item.id} className="space-y-1 py-2">
        <p><strong className="text-text-primary">{item.actor_name || 'Sistema'}</strong> · {new Date(item.created_at).toLocaleString('pt-BR')}</p>
        {item.reason && <p>{item.reason}</p>}
        {changes(item).map(change => <p key={change}>{change}</p>)}
      </li>)}</ul> : <p className="text-xs text-text-muted">Nenhuma alteração registrada.</p>)}
    </div>}
  </section>;
}
