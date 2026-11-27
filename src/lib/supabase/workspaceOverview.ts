import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dashboardPayments, doctorsWithDocumentIssues } from '@/lib/dashboardOverview';
import { doctorScheduleCompliance, getDocumentGovernance } from '@/lib/documentGovernance';
import { mapDoctorFromDb, mapDocumentFromDb, mapShiftFromDb } from '@/services/supabaseService';
import { workspaceDay } from '@/lib/workspaceScope';
import { workspaceDocuments } from '@/lib/workspaceQueries';
import type { DocumentOverview } from '@/lib/workspaceOverview';

// Each invocation owns its promises. Nothing is shared between sessions/companies.
export function workspaceOverviewReader(client: SupabaseClient, org: string, signal: AbortSignal,
  access: { documents: boolean; schedule: boolean; finance: boolean }) {
  async function read(table: string, columns: string) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const result = await client.from(table).select(columns).eq('organization_id', org)
        .order('id').range(offset, offset + 499).abortSignal(signal);
      if (result.error) throw new Error('Consulta indisponível.');
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
  }
  async function readShifts() {
    const columns = 'id,organization_id,doctor_id,unit_id,date,start_time,end_time,type,status'
      + (access.finance ? ',employment_type,payment_amount,payment_status,paid_amount,payment_due_date,payment_frequency' : '');
    return (await read('nv_staff_shifts', columns)).map(row => mapShiftFromDb(row as unknown as Parameters<typeof mapShiftFromDb>[0]));
  }
  let shifts: ReturnType<typeof readShifts> | undefined;
  const getShifts = () => shifts ||= readShifts();
  return {
    async finance() {
      if (!access.finance) throw new Error('Consulta indisponível.');
      return dashboardPayments(await getShifts(), workspaceDay());
    },
    async documents(): Promise<DocumentOverview> {
      if (!access.documents && !access.schedule) throw new Error('Consulta indisponível.');
      const [doctors, docs, history, organization] = await Promise.all([
        read('doctors', 'id,organization_id,name,crm,crm_uf,specialty,status,contract_model,contract_signed,linked_units'),
        access.documents ? workspaceDocuments<Parameters<typeof mapDocumentFromDb>[0]>(client, org, null, signal) : [],
        access.schedule ? getShifts() : [],
        client.from('organizations').select('settings').eq('id', org).abortSignal(signal).maybeSingle(),
      ]);
      if (organization.error || !organization.data) throw new Error('Consulta indisponível.');
      const mappedDoctors = doctors.map(row => mapDoctorFromDb(row as unknown as Parameters<typeof mapDoctorFromDb>[0]));
      const mappedDocuments = docs.map(mapDocumentFromDb);
      const documentsByDoctor = new Map<string, typeof mappedDocuments>();
      for (const document of mappedDocuments) {
        const items = documentsByDoctor.get(document.doctorId) || [];
        items.push(document); documentsByDoctor.set(document.doctorId, items);
      }
      const company = organization.data;
      const reference = Date.now(), governance = getDocumentGovernance(company);
      const schedule = Object.fromEntries(mappedDoctors.map(doctor => {
        const value = doctorScheduleCompliance(doctor, documentsByDoctor.get(doctor.id) || [], company, reference);
        return [doctor.id, { warning: value.warning, blocked: value.blocked }];
      }));
      const units: Record<string, string[]> = {};
      for (const shift of history) if (shift.doctorId) {
        const ids = units[shift.doctorId] ||= [];
        if (!ids.includes(shift.unitId)) ids.push(shift.unitId);
      }
      const issues = access.documents ? doctorsWithDocumentIssues(mappedDoctors, mappedDocuments, history, reference,
        company.settings?.requiredDocuments, Math.max(...governance.expiryAlertDays))
        .map(({ doctor, ...issue }) => ({ ...issue, doctor: { id: doctor.id, name: doctor.name, specialty: doctor.specialty } })) : [];
      return { issues, schedule, units };
    },
  };
}
