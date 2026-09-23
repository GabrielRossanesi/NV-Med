import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Organization, Doctor, Unit, Sector, MedicalDocument, Shift, DocumentStatus, DocumentType, UserAccount, DocumentAuditEntry } from '@/types';
import * as cloud from '@/services/supabaseService';
import { createClient } from '@/lib/supabase/client';

const anonymous: UserAccount = { id: '', name: '', email: '', type: 'tenant_user', organizationId: null, role: '', status: 'inactive', createdAt: '' };
const emptyData = { organizations: [] as Organization[], doctors: [] as Doctor[], units: [] as Unit[], sectors: [] as Sector[], documents: [] as MedicalDocument[], documentAudits: [] as DocumentAuditEntry[], shifts: [] as Shift[], users: [] as UserAccount[] };
type CloudData = Awaited<ReturnType<typeof cloud.fetchInitialDataFromSupabase>>;
interface NVMedState {
  activeOrganizationId: string; organizations: Organization[]; doctors: Doctor[]; units: Unit[]; sectors: Sector[]; documents: MedicalDocument[]; documentAudits: DocumentAuditEntry[]; shifts: Shift[];
  currentUser: UserAccount; users: UserAccount[]; isSimulating: boolean; simulatedOrganizationId: string | null;
  saving: boolean; error: string | null; notice: string | null;
  clearFeedback: () => void; clearSession: () => void;
  syncWithCloud: (data: CloudData) => void;
  setActiveOrganizationId: (id: string) => void;
  addDoctor: (doctor: Omit<Doctor, 'id' | 'organizationId'>) => Promise<boolean>;
  updateDoctor: (doctor: Doctor) => Promise<boolean>; deleteDoctor: (id: string) => Promise<boolean>;
  addUnit: (unit: Omit<Unit, 'id' | 'organizationId'>) => Promise<boolean>;
  updateUnit: (unit: Unit) => Promise<boolean>; deleteUnit: (id: string) => Promise<boolean>;
  addSector: (sector: Omit<Sector, 'id' | 'organizationId'>) => Promise<boolean>;
  updateSector: (sector: Sector) => Promise<boolean>; deleteSector: (id: string) => Promise<boolean>;
  addShift: (shift: Omit<Shift, 'id' | 'organizationId'>) => Promise<boolean>;
  addShifts: (shifts: Omit<Shift, 'id' | 'organizationId'>[]) => Promise<boolean>;
  updateShift: (shift: Shift) => Promise<boolean>;
  updateShiftPayment: (id: string, status: Shift['paymentStatus']) => Promise<boolean>;
  updateShiftFinancials: (id: string, amount: number, frequency: NonNullable<Shift['paymentFrequency']>, status: NonNullable<Shift['paymentStatus']>) => Promise<boolean>;
  deleteShift: (id: string) => Promise<boolean>;
  uploadDocument: (doctorId: string, type: DocumentType, file: File) => Promise<boolean>;
  updateDocumentStatus: (documentId: string, status: DocumentStatus) => Promise<boolean>;
  updateDocument: (document: MedicalDocument) => Promise<boolean>;
  bulkUpdateDocuments: (documentIds: string[], status: DocumentStatus, reviewNote?: string) => Promise<boolean>;
  addOrganization: (org: Omit<Organization, 'id'>) => Promise<boolean>;
  updateOrganization: (org: Organization) => Promise<boolean>;
  deleteOrganization: (id: string, confirmation: string) => Promise<boolean>;
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>) => Promise<boolean>;
  addUser: (user: Omit<UserAccount, 'id' | 'createdAt'>) => Promise<boolean>;
  updateUser: (user: UserAccount) => Promise<boolean>;
  deleteUser: (id: string, confirmation: string) => Promise<boolean>;
  setUserTemporaryPassword: (id: string, password: string) => Promise<boolean>;
  startSimulation: (orgId: string) => void; stopSimulation: () => void;
  theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void;
  sidebarCollapsed: boolean; setSidebarCollapsed: (collapsed: boolean) => void;
  updateProfile: (form: FormData) => Promise<boolean>;
}

export const useStore = create<NVMedState>()(persist((set, get) => {
  async function commit(work: () => Promise<void>) {
    if (get().saving) return false;
    set({ saving: true, error: null, notice: null });
    try { await work(); set({ notice: 'Alteração salva no banco.' }); return true; }
    catch (error) { set({ error: error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.' }); return false; }
    finally { set({ saving: false }); }
  }
  function orgId() {
    const id = get().activeOrganizationId;
    if (!id || !get().organizations.some(o => o.id === id)) throw new Error('Selecione uma empresa antes de continuar.');
    return id;
  }
  async function refreshDocumentAudits() {
    try { set({ documentAudits: await cloud.fetchDocumentAuditLogsFromSupabase() }); }
    catch { /* The audit migration may not have been applied yet. */ }
  }
  return {
    ...emptyData, activeOrganizationId: '', currentUser: anonymous, isSimulating: false, simulatedOrganizationId: null,
    saving: false, error: null, notice: null, theme: 'dark', sidebarCollapsed: true,
    setTheme: theme => set({ theme }), clearFeedback: () => set({ error: null, notice: null }),
    setSidebarCollapsed: sidebarCollapsed => set({ sidebarCollapsed }),
    clearSession: () => set({ ...emptyData, currentUser: anonymous, activeOrganizationId: '', isSimulating: false, simulatedOrganizationId: null, error: null, notice: null }),
    syncWithCloud: data => set(state => ({ ...data, activeOrganizationId: data.currentUser.type === 'tenant_user' ? data.currentUser.organizationId || '' : (data.organizations.some(o => o.id === state.activeOrganizationId) ? state.activeOrganizationId : data.organizations[0]?.id || '') })),
    setActiveOrganizationId: id => { if (get().currentUser.type === 'saas_admin' && get().organizations.some(o => o.id === id)) set({ activeOrganizationId: id }); },
    addDoctor: input => commit(async () => {
      const doctor = { ...input, id: crypto.randomUUID(), organizationId: orgId() };
      // The database trigger creates required document rows in the same transaction.
      await cloud.saveDoctorToSupabase(doctor);
      set({ doctors: [...get().doctors, doctor] });
      try { get().syncWithCloud(await cloud.fetchInitialDataFromSupabase()); }
      catch { throw new Error('Médico salvo, mas a atualização da lista falhou. Recarregue antes de cadastrar novamente.'); }
    }),
    updateDoctor: doctor => commit(async () => { await cloud.saveDoctorToSupabase(doctor); set({ doctors: get().doctors.map(d => d.id === doctor.id ? doctor : d) }); }),
    deleteDoctor: id => commit(async () => { await cloud.deleteDoctorFromSupabase(id); set({ doctors: get().doctors.filter(d => d.id !== id), documents: get().documents.filter(d => d.doctorId !== id), shifts: get().shifts.filter(s => s.doctorId !== id) }); }),
    addUnit: input => commit(async () => { const unit = { ...input, id: crypto.randomUUID(), organizationId: orgId() }; await cloud.saveUnitToSupabase(unit); set({ units: [...get().units, unit] }); }),
    updateUnit: unit => commit(async () => { await cloud.saveUnitToSupabase(unit); set({ units: get().units.map(u => u.id === unit.id ? unit : u) }); }),
    deleteUnit: id => commit(async () => { await cloud.deleteUnitFromSupabase(id); set({ units: get().units.filter(u => u.id !== id), sectors: get().sectors.filter(s => s.unitId !== id), shifts: get().shifts.filter(s => s.unitId !== id) }); }),
    addSector: input => commit(async () => { const sector = { ...input, id: crypto.randomUUID(), organizationId: orgId() }; await cloud.saveSectorToSupabase(sector); set({ sectors: [...get().sectors, sector] }); }),
    updateSector: sector => commit(async () => { await cloud.saveSectorToSupabase(sector); set({ sectors: get().sectors.map(s => s.id === sector.id ? sector : s) }); }),
    deleteSector: id => commit(async () => { await cloud.deleteSectorFromSupabase(id); set({ sectors: get().sectors.filter(s => s.id !== id) }); }),
    addShift: input => commit(async () => { const shift = { ...input, id: crypto.randomUUID(), organizationId: orgId() }; await cloud.saveShiftToSupabase(shift); set({ shifts: [...get().shifts, shift] }); }),
    addShifts: inputs => commit(async () => { const shifts = inputs.map(input => ({ ...input, id: crypto.randomUUID(), organizationId: orgId() })); await cloud.saveShiftsToSupabase(shifts); set({ shifts: [...get().shifts, ...shifts] }); }),
    updateShift: shift => commit(async () => { await cloud.saveShiftToSupabase(shift); set({ shifts: get().shifts.map(s => s.id === shift.id ? shift : s) }); }),
    updateShiftPayment: (id, status) => commit(async () => {
      const current = get().shifts.find(shift => shift.id === id && shift.organizationId === orgId());
      if (!current) throw new Error('Plantão não encontrado nesta empresa.');
      const updated = await cloud.updateShiftPaymentInSupabase(id, status);
      set({ shifts: get().shifts.map(shift => shift.id === id ? updated : shift) });
    }),
    updateShiftFinancials: (id, amount, frequency, status) => commit(async () => {
      const current = get().shifts.find(shift => shift.id === id && shift.organizationId === orgId());
      if (!current) throw new Error('Plantão não encontrado nesta empresa.');
      const updated = await cloud.updateShiftFinancialsInSupabase(id, amount, frequency, status);
      set({ shifts: get().shifts.map(shift => shift.id === id ? updated : shift) });
    }),
    deleteShift: id => commit(async () => { await cloud.deleteShiftFromSupabase(id); set({ shifts: get().shifts.filter(s => s.id !== id) }); }),
    uploadDocument: (doctorId, type, file) => commit(async () => {
      const doctor = get().doctors.find(d => d.id === doctorId && d.organizationId === orgId());
      if (!doctor) throw new Error('Médico não encontrado nesta empresa.');
      const previous = get().documents.find(d => d.doctorId === doctorId && d.type === type);
      const uploaded = await cloud.uploadDocumentFileToSupabase(file, doctor.organizationId, doctorId);
      const doc: MedicalDocument = { ...previous, ...uploaded, id: previous?.id || crypto.randomUUID(), doctorId, organizationId: doctor.organizationId, type, name: previous?.name || type, status: 'sent', uploadDate: new Date().toISOString().slice(0, 10) };
      let saved: MedicalDocument;
      try { saved = await cloud.saveDocumentToSupabase(doc); }
      catch (error) { await createClient()?.storage.from('medical-documents').remove([uploaded.filePath]); throw error; }
      set({ documents: [...get().documents.filter(d => d.id !== saved.id), saved] });
      await refreshDocumentAudits();
    }),
    updateDocumentStatus: (id, status) => commit(async () => { const previous = get().documents.find(d => d.id === id); if (!previous) throw new Error('Documento não encontrado.'); const saved = await cloud.saveDocumentToSupabase({ ...previous, status }); set({ documents: get().documents.map(d => d.id === id ? saved : d) }); await refreshDocumentAudits(); }),
    updateDocument: document => commit(async () => { const saved = await cloud.saveDocumentToSupabase(document); set({ documents: get().documents.map(item => item.id === document.id ? saved : item) }); await refreshDocumentAudits(); }),
    bulkUpdateDocuments: (documentIds, status, reviewNote) => commit(async () => {
      const idSet = new Set(documentIds);
      const selected = get().documents.filter(document => idSet.has(document.id) && document.organizationId === orgId());
      if (!selected.length) throw new Error('Selecione ao menos um documento desta empresa.');
      if (status === 'rejected' && !reviewNote?.trim()) throw new Error('Informe o motivo da reprovação.');
      const saved = await cloud.saveDocumentsToSupabase(selected.map(document => ({ ...document, status, reviewNote: reviewNote?.trim() || document.reviewNote })));
      const savedMap = new Map(saved.map(document => [document.id, document]));
      set({ documents: get().documents.map(document => savedMap.get(document.id) || document) });
      await refreshDocumentAudits();
    }),
    addOrganization: input => commit(async () => { const org = { ...input, id: crypto.randomUUID() }; await cloud.createOrganizationInSupabase(org); set({ organizations: [...get().organizations, org], activeOrganizationId: org.id }); }),
    updateOrganization: org => commit(async () => { await cloud.updateOrganizationInSupabase(org); set({ organizations: get().organizations.map(o => o.id === org.id ? org : o) }); }),
    deleteOrganization: (id, confirmation) => commit(async () => {
      const res = await fetch('/api/admin/organizations', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, confirmation }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Não foi possível excluir a empresa.');
      const organizations = get().organizations.filter(item => item.id !== id);
      set({
        organizations,
        doctors: get().doctors.filter(item => item.organizationId !== id),
        units: get().units.filter(item => item.organizationId !== id),
        sectors: get().sectors.filter(item => item.organizationId !== id),
        documents: get().documents.filter(item => item.organizationId !== id),
        documentAudits: get().documentAudits.filter(item => item.organizationId !== id),
        shifts: get().shifts.filter(item => item.organizationId !== id),
        users: get().users.filter(item => item.organizationId !== id),
        activeOrganizationId: get().activeOrganizationId === id ? organizations[0]?.id || '' : get().activeOrganizationId,
        isSimulating: get().simulatedOrganizationId === id ? false : get().isSimulating,
        simulatedOrganizationId: get().simulatedOrganizationId === id ? null : get().simulatedOrganizationId,
      });
    }),
    updateOrganizationSettings: (id, updates) => commit(async () => {
      const previous = get().organizations.find(o => o.id === id);
      if (!previous) throw new Error('Empresa não encontrada.');
      const org = { ...previous, ...updates };
      await cloud.updateOrganizationInSupabase(org);
      const refreshedDocuments = updates.settings
        ? await cloud.fetchMedicalDocumentsForOrganization(id)
        : null;
      set({
        organizations: get().organizations.map(o => o.id === id ? org : o),
        documents: refreshedDocuments
          ? [...get().documents.filter(document => document.organizationId !== id), ...refreshedDocuments]
          : get().documents,
      });
    }),
    addUser: input => commit(async () => { const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível criar o acesso.'); set({ users: [...get().users, result.user] }); }),
    updateUser: user => commit(async () => { const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível atualizar o acesso.'); set({ users: get().users.map(u => u.id === user.id ? result.user : u) }); }),
    deleteUser: (id, confirmation) => commit(async () => { const res = await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, confirmation }) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível excluir o usuário.'); set({ users: get().users.filter(user => user.id !== id) }); }),
    setUserTemporaryPassword: (id, password) => commit(async () => { const res = await fetch('/api/admin/users/password', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password }) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível atualizar a senha.'); }),
    updateProfile: form => commit(async () => { const res = await fetch('/api/profile', { method: 'POST', body: form }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível atualizar o perfil.'); set({ currentUser: result.user, users: get().users.map(u => u.id === result.user.id ? result.user : u) }); }),
    startSimulation: id => { if (get().currentUser.type === 'saas_admin' && get().organizations.some(o => o.id === id)) set({ isSimulating: true, simulatedOrganizationId: id, activeOrganizationId: id }); },
    stopSimulation: () => set({ isSimulating: false, simulatedOrganizationId: null }),
  };
}, {
  name: 'nv-med-preferences',
  skipHydration: true,
  partialize: state => ({ theme: state.theme, activeOrganizationId: state.activeOrganizationId }),
  merge: (saved, current) => ({
    ...current,
    theme: (saved as { theme?: string })?.theme === 'light' ? 'light' : 'dark',
    activeOrganizationId: (saved as { activeOrganizationId?: string })?.activeOrganizationId || '',
    sidebarCollapsed: true,
  }),
}));
