import type { Sector } from '@/types';

export const shiftReportStates = {
  open: 'Vaga aberta', exchange: 'Troca solicitada', confirmed: 'Confirmado', pending: 'Aguardando confirmação',
  completed: 'Concluído', cancelled: 'Cancelado',
};
export const presenceReportStates = { pending: 'Check-in pendente', checked_in: 'Check-in registrado', checked_out: 'Check-out registrado' };

export type ReportRow = {
  id: string; organization: string; unit: string; sector: string; doctor: string | null; specialty: string | null;
  date: string; start_time: string; end_time: string; status: keyof typeof shiftReportStates;
  presence: keyof typeof presenceReportStates | null; check_in: string | null; check_out: string | null;
  payment: 'pending' | 'scheduled' | 'overdue' | 'paid' | 'cancelled' | null;
  agreed: number | null; due: string | null; paid_on: string | null; paid_amount: number | null;
  unit_id?: string; doctor_id?: string | null; period?: 'day' | 'night';
  frequency?: 'on_delivery' | 'monthly' | null; balance?: number | null;
  crm?: string | null; employment?: string | null; employer?: string | null;
};
export type ShiftReport = { organization?: string; finance: boolean; attendance: boolean; rows: ReportRow[] };
export type ReportCatalog = {
  finance: boolean; attendance: boolean;
  units: { id: string; name: string }[];
  sectors: Pick<Sector, 'id' | 'unitId' | 'name' | 'specialties' | 'coveragePeriods' | 'defaultStartTime' | 'defaultEndTime' | 'requiredDoctors'>[];
  doctors: { id: string; name: string; crm: string | null; crmUf: string | null; specialty: string }[];
  specialties: string[];
};
export const reportFrequencyLabels = { on_delivery: 'À vista', monthly: 'Mensal' };
export const reportPeriodLabels = { day: 'Diurno', night: 'Noturno' };
export const reportFilterKeys = {
  unidade: 'unit', posto: 'sector', medico: 'doctor', especialidade: 'specialty', situacao: 'state',
  presenca: 'presence', pagamento: 'payment', modalidade: 'frequency', turno: 'period', plantao: 'shift_id',
  hora_inicio: 'start_hour', hora_fim: 'end_hour', vence_de: 'due_from', vence_ate: 'due_to',
  pago_de: 'paid_from', pago_ate: 'paid_to',
} as const;
