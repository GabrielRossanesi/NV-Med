'use client';
import Link from 'next/link';
import { useMasterSchedule } from './useMasterSchedule';
import DoctorAbsenceManager from './DoctorAbsenceManager';
import type { Doctor } from '@/types';
import type { ComponentProps } from 'react';
import { ScheduleEditBoundary, ScheduleEditControl } from './ScheduleEditGuard';

function DoctorMasterContent({ organization, doctor, canManage, onChanged }: {
  organization: string; doctor: Doctor; canManage: boolean; onChanged: () => Promise<void>;
}) {
  const { data, error, reload } = useMasterSchedule(organization, null, null, doctor.id);
  return <section className="nv-panel space-y-4 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="nv-section-title">Escala fixa e ausências</h2><Link className="nv-button-secondary" href={'/escala?' + new URLSearchParams({ mode: 'master', ...(doctor.linkedUnits[0] ? { unitId: doctor.linkedUnits[0] } : {}) })}>Abrir Escala Master</Link></div>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : !data ? <p role="status" className="text-sm text-text-muted">Carregando recorrências…</p> : <>
      <p className="text-sm text-text-secondary">{data.rules.filter(rule => rule.status === 'active').length} recorrências ativas deste médico.</p>
      <DoctorAbsenceManager organization={organization} doctorId={doctor.id} doctors={[doctor]} data={data} canManage={canManage} onChanged={async () => { await Promise.all([reload(), onChanged()]); }}/>
    </>}
  </section>;
}
export default function DoctorMasterSchedule(props: ComponentProps<typeof DoctorMasterContent>) {
  return <ScheduleEditBoundary><div className="space-y-3"><ScheduleEditControl/><DoctorMasterContent {...props}/></div></ScheduleEditBoundary>;
}
