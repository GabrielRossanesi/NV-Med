import { createClient } from '@/lib/supabase/client';
import type { AbsenceImpact, DoctorAbsence, MasterDefinition, MasterOverview, MasterShiftContext } from '@/lib/masterSchedule';
import type { ShiftAgreementSelection } from '@/types';
import type { ScheduleHistoryPage } from '@/lib/scheduleAudit';

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const client = createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.code === 'PGRST202' || error.code === '42P01'
    ? 'A Escala Master ainda não foi habilitada neste ambiente.'
    : error.message || 'Não foi possível concluir a operação.');
  return data as T;
}
export const masterOverview = (org: string, unit: string | null = null, sector: string | null = null, doctor: string | null = null, sectors?: string[]) =>
  unit && sectors ? rpc<MasterOverview>('nv_master_overview_scoped', { org, unit_filter: unit, sector_filters: sectors, doctor_filter: doctor })
  : rpc<MasterOverview>('nv_master_overview', { org, unit_filter: unit, sector_filter: sector, doctor_filter: doctor });
export const saveMasterRule = (org: string, target: string | null, definition: MasterDefinition, revision: number, effectiveFrom: string,
  horizon: number, agreement: ShiftAgreementSelection | null, confirmed: boolean) => rpc<{ id: string; generation: Record<string, number> }>('nv_master_save_rule', {
    org, target, spec: definition, expected_revision: revision, effective_from: effectiveFrom, horizon, agreement, confirmed,
  });
export const masterRuleStatus = (target: string, state: string, revision: number, decision: 'keep' | 'open', confirmed: boolean) =>
  rpc('nv_master_rule_status', { target, next_state: state, expected_revision: revision, future_decision: decision, confirmed });
export const generateMaster = (org: string, target: string | null = null, unit: string | null = null, sector: string | null = null, sectors?: string[]) =>
  unit && sectors ? rpc<Record<string, number>>('nv_master_generate_scoped', { org, unit_filter: unit, sector_filters: sectors })
  : rpc<Record<string, number>>('nv_master_generate', { org, target, unit_filter: unit, sector_filter: sector });
export const previewAbsence = (org: string, spec: Partial<DoctorAbsence>, target: string | null = null, cancelling = false) =>
  rpc<{ token: string; impacts: AbsenceImpact[] }>('nv_master_preview_absence', { org, spec, target, cancelling });
export const saveAbsence = (org: string, spec: Partial<DoctorAbsence>, target: string | null, revision: number, token: string, cancelling = false) =>
  rpc<{ id: string; changed: number; preserved: number; blocked: number }>('nv_master_apply_absence', { org, spec, target, expected_revision: revision, preview_token: token, cancelling, confirmed: true });
export const masterShiftContext = (ids: string[]) => rpc<MasterShiftContext[]>('nv_master_shift_context', { ids });
export const myAbsences = () => rpc<(DoctorAbsence & { shifts: { shift_id: string; date: string; state: string }[] })[]>('nv_master_my_absences');

export const publishMasterCoverage = (target: string, enabled: boolean) => rpc('nv_master_publish_coverage', { target, enabled });
export const scheduleHistory = (args: Record<string, unknown>) => rpc<ScheduleHistoryPage>('nv_schedule_history', args);
