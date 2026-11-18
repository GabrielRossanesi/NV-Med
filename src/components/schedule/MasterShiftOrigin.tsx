'use client';
import { useEffect, useState } from 'react';
import { masterShiftContext } from '@/services/masterScheduleService';
import type { MasterShiftContext } from '@/lib/masterSchedule';
import { auditLabel } from './ScheduleMasterView';

export default function MasterShiftOrigin({ ids, date, canEdit, onEditRule, editingOccurrence = false }: {
  ids: string[]; date: string; canEdit: boolean; editingOccurrence?: boolean;
  onEditRule?: (context: MasterShiftContext, date?: string) => void;
}) {
  const key = JSON.stringify(ids.slice().sort());
  const [result, setResult] = useState<{ key: string; items?: MasterShiftContext[]; error?: string }>();
  useEffect(() => {
    let live = true;
    void masterShiftContext(JSON.parse(key)).then(items => { if (live) setResult({ key, items }); })
      .catch(() => { if (live) setResult({ key, error: 'Não foi possível consultar a origem dos plantões.' }); });
    return () => { live = false; };
  }, [key]);
  if (result?.key !== key || !result.items?.length) return result?.key === key && result.error ? <p className="text-xs text-text-muted">{result.error}</p> : null;
  return <section className="space-y-3 rounded-xl border border-border bg-surface-muted/25 p-4" aria-label="Origem e coberturas dos plantões">
    {result.items.map(item => <div key={item.shift_id} className="space-y-2"><p className="text-xs font-semibold">{item.rule_id ? 'Origem: Escala Master' : 'Plantão com cobertura de ausência'}{item.original_doctor_name ? ` · Fixo: ${item.original_doctor_name}` : ''}</p>
      {item.coverage && <p className="text-xs text-text-secondary">Este posto possui histórico de cobertura. A atribuição atual está na Escala Geral.</p>}
      {item.rule_id && <p className="text-xs text-text-muted">{editingOccurrence ? 'A edição deste formulário altera somente esta ocorrência.' : 'Abra o plantão para alterar somente esta ocorrência.'} Ajustes manuais são preservados nas próximas gerações.</p>}
      {item.rule_id && canEdit && onEditRule && <div className="flex flex-wrap gap-3"><button type="button" className="min-h-9 text-xs font-semibold text-primary" onClick={() => onEditRule(item, date)}>Alterar esta e as próximas</button><button type="button" className="min-h-9 text-xs font-semibold text-primary" onClick={() => onEditRule(item)}>Editar regra completa</button></div>}
      {item.history.length > 0 && <details><summary className="cursor-pointer text-xs font-medium text-text-secondary">Histórico da origem e cobertura</summary><div className="mt-2 space-y-1">{item.history.map((entry, index) => <p key={index} className="text-[11px] text-text-muted">{new Date(entry.created_at).toLocaleString('pt-BR')} · {auditLabel(entry.action)}</p>)}</div></details>}
    </div>)}
  </section>;
}
