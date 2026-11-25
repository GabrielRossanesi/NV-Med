export const scheduleAuditLabels: Record<string, string> = {
  shift_approved: 'Aprovou plantão', shift_approval_invalidated: 'Invalidou confirmação',
  shift_retroactively_edited: 'Editou plantão encerrado',
  shift_created: 'Criou plantão', shift_edited: 'Alterou plantão', shift_deleted: 'Excluiu plantão', shift_cancelled: 'Cancelou plantão',
  vacancy_opened: 'Removeu médico / abriu vaga', vacancy_filled: 'Preencheu vaga', doctor_replaced: 'Substituiu médico',
  rule_created: 'Criou recorrência', rule_edited: 'Alterou recorrência', rule_suspended: 'Suspendeu recorrência', rule_ended: 'Encerrou recorrência', rule_active: 'Reativou recorrência',
  absence_created: 'Registrou ausência', absence_edited: 'Alterou ausência', absence_cancelled: 'Cancelou ausência',
  coverage_published: 'Abriu candidaturas', coverage_pending: 'Retirou oferta de candidaturas', generation_scheduled: 'Executou geração diária', generation_failed: 'Falha na geração diária',
  occurrence_generated: 'Gerou ocorrência', occurrence_manual: 'Ajustou ocorrência', occurrence_retired: 'Liberou ocorrência futura', coverage_changed: 'Alterou cobertura',
  coverage_post_created: 'Criou posto fracionado', coverage_plan_changed: 'Alterou período previsto',
  coverage_post_cancelled: 'Cancelou posto fracionado',
  coverage_gap_created: 'Gerou vaga descoberta', coverage_gap_retired: 'Encerrou vaga descoberta',
};
export const scheduleOriginLabels: Record<string, string> = { doctor: 'Portal Médico', administrative: 'Administrativo', automatic: 'Prazo expirado', manual: 'Manual', cron: 'Cron da Escala Master', master: 'Escala Master', approval: 'Aprovação de candidatura ou troca', portal: 'Portal Médico', import: 'Importação', database: 'Processo do banco' };
export interface ScheduleAuditEntry {
  organization_id?: string; organization?: string | null; correlation_id?: string | null;
  id: number; entity_id: string; shift_id: string | null; action: string; actor_id: string | null; actor_name: string | null; actor_role: string | null;
  origin: string | null; previous: Record<string, unknown> | null; next: Record<string, unknown> | null; created_at: string; shift_date: string | null; unit: string | null; sector: string | null;
}
export interface ScheduleHistoryPage { items: ScheduleAuditEntry[]; actors: { id: string; name: string | null }[]; has_more: boolean }
