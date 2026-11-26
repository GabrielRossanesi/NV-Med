'use client';

import { Suspense } from 'react';
import AccessGuard from '@/components/AccessGuard';
import DoctorDirectory from '@/components/doctors/DoctorDirectory';
import { useStore } from '@/store/useStore';

function DirectoryContent() {
  const company = useStore(state => state.activeOrganizationId);
  return company ? <DoctorDirectory key={company} organization={company}/> : <p role="status">Selecione uma empresa para consultar os médicos.</p>;
}

export default function DoctorsPage() {
  return <AccessGuard requiredPermission="medicos">
    <Suspense fallback={<p role="status">Carregando listagem…</p>}><DirectoryContent/></Suspense>
  </AccessGuard>;
}
