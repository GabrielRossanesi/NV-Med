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
};
export type ShiftReport = { finance: boolean; attendance: boolean; rows: ReportRow[] };
