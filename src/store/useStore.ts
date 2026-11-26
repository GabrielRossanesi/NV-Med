import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Organization, Doctor, DoctorStatus, Unit, Sector, SectorFinanceDefaults, MedicalDocument, Shift, ShiftWrite, DocumentStatus, DocumentType, UserAccount, DocumentAuditEntry } from '@/types';
import * as cloud from '@/services/supabaseService';
import { vacateShift } from '@/lib/scheduleDeletion';
import { canEditPermission, canPerformAction } from '@/lib/permissions';
import type { DoctorBanking } from '@/lib/doctorBanking';
import { notify } from '@/lib/notifications';
import { defaultAccountPreferences, type AccountPreferences } from '@/lib/account';
import { createClient } from '@/lib/supabase/client';
import { coverageSaveMessage } from '@/lib/fractionalCoverage';
import { doctorStatusActions } from '@/lib/doctorStatus';
import { sendMedicalDocument, type DocumentUploadOptions } from '@/lib/medicalUpload';

const anonymous: UserAccount = { id: '', name: '', email: '', type: 'tenant_user', organizationId: null, role: '', status: 'inactive', createdAt: '' };
const emptyData = { organizations: [] as Organization[], doctors: [] as Doctor[], units: [] as Unit[], sectors: [] as Sector[], documents: [] as MedicalDocument[], documentAudits: [] as DocumentAuditEntry[], shifts: [] as Shift[], users: [] as UserAccount[] };
type CloudData = Awaited<ReturnType<typeof cloud.fetchInitialDataFromSupabase>>;
type SaveFeedback = { success?: string | false | (() => string); description?: string; inlineError?: boolean; withinDialog?: boolean; progress?: boolean };

interface NVMedState {
  doctorDirectorySummary: { organizationId: string; documentIssues: number } | null;
  activeOrganizationId: string; organizations: Organization[]; doctors: Doctor[]; units: Unit[]; sectors: Sector[]; documents: MedicalDocument[]; documentAudits: DocumentAuditEntry[]; shifts: Shift[];
  currentUser: UserAccount; users: UserAccount[]; isSimulating: boolean; simulatedOrganizationId: string | null;
  saving: boolean; error: string | null;
  clearFeedback: () => void; clearSession: () => void;
  syncWithCloud: (data: CloudData) => void;
  setActiveOrganizationId: (id: string) => void;
  addDoctor: (doctor: Omit<Doctor, 'id' | 'organizationId'>, banking?: DoctorBanking) => Promise<string | null>;
  setDoctorStatus: (id: string, status: DoctorStatus) => Promise<boolean>;
  updateDoctorContract: (id: string, changes: Partial<Pick<Doctor, 'contractModel' | 'contractSigned'>>) => Promise<boolean>;
  deleteDoctor: (id: string) => Promise<boolean>;
  addUnit: (unit: Omit<Unit, 'id' | 'organizationId'>) => Promise<boolean>;
  updateUnit: (unit: Unit, feedback?: SaveFeedback) => Promise<boolean>; deleteUnit: (id: string) => Promise<boolean>;
  addSector: (sector: Omit<Sector, 'id' | 'organizationId'>, finance?: SectorFinanceDefaults, feedback?: SaveFeedback) => Promise<Sector | null>;
  updateSector: (sector: Sector, finance?: SectorFinanceDefaults) => Promise<boolean>; deleteSector: (id: string) => Promise<boolean>;
  addShift: (shift: Omit<ShiftWrite, 'id' | 'organizationId'>, draftId?: string) => Promise<boolean>;
  addShifts: (shifts: Omit<ShiftWrite, 'id' | 'organizationId'>[], feedback?: SaveFeedback) => Promise<boolean>;
  updateShift: (shift: ShiftWrite) => Promise<boolean>;
  saveCoverageDraft: (...input: Parameters<typeof cloud.saveCoverageDraftToSupabase>) => Promise<boolean>;
  publishCoverage: (shift: Shift, enabled: boolean) => Promise<boolean>;
  cancelCoverage: (shift: Shift) => Promise<boolean>;
  updateShiftPayment: (id: string, status: Shift['paymentStatus']) => Promise<boolean>;
  updateShiftFinancials: (...input: Parameters<typeof cloud.updateShiftFinancialsInSupabase>) => Promise<boolean>;
  updateShiftAgreement: (...input: Parameters<typeof cloud.editShiftAgreement>) => Promise<boolean>;
  deleteShift: (id: string) => Promise<boolean>;
  deleteShifts: (ids: string[]) => Promise<boolean>;
  vacateShifts: (ids: string[]) => Promise<boolean>;
  uploadDocument: (doctorId: string, type: DocumentType, file: File, options?: DocumentUploadOptions) => Promise<boolean>;
  updateDocumentStatus: (documentId: string, status: DocumentStatus) => Promise<boolean>;
  updateDocument: (document: MedicalDocument) => Promise<boolean>;
  bulkUpdateDocuments: (documentIds: string[], status: DocumentStatus, reviewNote?: string) => Promise<boolean>;
  addOrganization: (org: Omit<Organization, 'id'>) => Promise<boolean>;
  updateOrganization: (org: Organization) => Promise<boolean>;
  deleteOrganization: (id: string, confirmation: string) => Promise<boolean>;
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>, feedback?: SaveFeedback) => Promise<boolean>;
  addUser: (user: Omit<UserAccount, 'id' | 'createdAt'> & { reason?: string }) => Promise<boolean>;
  updateUser: (user: UserAccount & { reason?: string }) => Promise<boolean>;
  deleteUser: (id: string, confirmation: string) => Promise<boolean>;
  setUserTemporaryPassword: (id: string, password: string) => Promise<boolean>;
  startSimulation: (orgId: string) => void; stopSimulation: () => void;
  theme: AccountPreferences['theme']; setTheme: (theme: AccountPreferences['theme']) => void;
  sidebarCollapsed: boolean; setSidebarCollapsed: (collapsed: boolean) => void;
  accountPreferences: AccountPreferences;
  accountPreferencesStatus: 'loading' | 'ready' | 'error';
  hasSavedAccountPreferences: boolean;
  loadAccountPreferences: () => Promise<void>;
  saveAccountPreferences: (changes: Partial<AccountPreferences>, quiet?: boolean) => Promise<boolean>;
  updateProfile: (form: FormData) => Promise<boolean>;
}

export const useStore = create<NVMedState>()(persist((set, get) => {
  let preferenceWrites = Promise.resolve<boolean>(true);
  async function commit(work: () => Promise<void>, { success = 'Alterações salvas.', description, inlineError = false, withinDialog, progress = true }: SaveFeedback = {}) {
    if (get().saving) return false;
    set({ saving: true, error: null });
    const finishSaving = progress ? notify.saving() : undefined;
    try {
      await work();
      if (success) notify.success(typeof success === 'function' ? success() : success, { description, withinDialog });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.';
      set({ error: message });
      if (!inlineError) notify.error('Não foi possível concluir a ação.', { description: message, persistent: true });
      return false;
    } finally {
      finishSaving?.();
      set({ saving: false });
    }
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
    saving: false, error: null, theme: 'light', sidebarCollapsed: true, doctorDirectorySummary: null,
    accountPreferences: defaultAccountPreferences, accountPreferencesStatus: 'loading', hasSavedAccountPreferences: false,
    async loadAccountPreferences() {
      const owner = get().currentUser.id;
      if (!owner) return;
      set({ accountPreferencesStatus: 'loading' });
      try {
        const result = await createClient()?.rpc('nv_account_preferences');
        if (!result || result.error) throw new Error();
        if (get().currentUser.id !== owner) return;
        const accountPreferences: AccountPreferences = result.data
          ? { ...defaultAccountPreferences, ...result.data }
          : { ...defaultAccountPreferences, theme: get().theme, sidebarCollapsed: get().sidebarCollapsed };
        set({ accountPreferences, theme: accountPreferences.theme, sidebarCollapsed: accountPreferences.sidebarCollapsed,
          accountPreferencesStatus: 'ready', hasSavedAccountPreferences: Boolean(result.data) });
      } catch {
        if (get().currentUser.id === owner) set({ accountPreferencesStatus: 'error' });
      }
    },
    saveAccountPreferences(changes, quiet = false) {
      const owner = get().currentUser.id;
      const write = async () => {
        if (!owner || get().currentUser.id !== owner) return false;
        const finish = quiet ? undefined : notify.saving();
        try {
          const baseline = get().accountPreferences;
          const initialAppearance = get().hasSavedAccountPreferences ? {}
            : { theme: baseline.theme, sidebarCollapsed: baseline.sidebarCollapsed };
          const result = await createClient()?.rpc('nv_save_account_preferences', { changes: { ...initialAppearance, ...changes } });
          if (!result || result.error || !result.data) throw new Error();
          if (get().currentUser.id !== owner) return false;
          const accountPreferences: AccountPreferences = { ...defaultAccountPreferences, ...result.data };
          set({ accountPreferences, hasSavedAccountPreferences: true,
            theme: accountPreferences.theme, sidebarCollapsed: accountPreferences.sidebarCollapsed });
          if (!quiet) notify.success('Preferências salvas.');
          return true;
        } catch {
          if (get().currentUser.id === owner) notify.error('Não foi possível sincronizar as preferências.');
          return false;
        } finally { finish?.(); }
      };
      preferenceWrites = preferenceWrites.then(write);
      return preferenceWrites;
    },
    setTheme: theme => {
      set({ theme });
      if (get().accountPreferencesStatus === 'ready') void get().saveAccountPreferences({ theme }, true);
    },
    setSidebarCollapsed: sidebarCollapsed => {
      set({ sidebarCollapsed });
      if (get().accountPreferencesStatus === 'ready') void get().saveAccountPreferences({ sidebarCollapsed }, true);
    },
    clearFeedback: () => set({ error: null }),
    clearSession: () => set({ ...emptyData, doctorDirectorySummary: null, currentUser: anonymous, activeOrganizationId: '', isSimulating: false, simulatedOrganizationId: null, error: null,
      theme: defaultAccountPreferences.theme, sidebarCollapsed: defaultAccountPreferences.sidebarCollapsed,
      accountPreferences: defaultAccountPreferences, accountPreferencesStatus: 'loading', hasSavedAccountPreferences: false }),
    syncWithCloud: data => set(state => ({ ...data, activeOrganizationId: data.currentUser.type === 'tenant_user' ? data.currentUser.organizationId || '' : (data.organizations.some(o => o.id === state.activeOrganizationId) ? state.activeOrganizationId : data.organizations[0]?.id || '') })),
    setActiveOrganizationId: id => { if (get().currentUser.type === 'saas_admin' && get().organizations.some(o => o.id === id)) set({ activeOrganizationId: id }); },
    async addDoctor(input, banking) {
      const id = crypto.randomUUID();
      const saved = await commit(async () => {
        const doctor = { ...input, status: banking ? input.status : 'pending' as const, id, organizationId: orgId() };
        // The database trigger creates required document rows in the same transaction.
        await cloud.createDoctorInSupabase(doctor, banking);
        set({ doctors: [...get().doctors, doctor] });
        try { get().syncWithCloud(await cloud.fetchInitialDataFromSupabase()); }
        catch { throw new Error('Médico salvo, mas a atualização da lista falhou. Recarregue antes de cadastrar novamente.'); }
      }, { success: 'Médico cadastrado.', inlineError: true });
      return saved ? id : null;
    },
    updateDoctorContract: (id, changes) => commit(async () => {
      await cloud.updateDoctorContractInSupabase(id, changes);
      set(state => ({ doctors: state.doctors.map(doctor => doctor.id === id ? { ...doctor, ...changes } : doctor) }));
    }),
    setDoctorStatus: (id, status) => commit(async () => {
      const doctor = get().doctors.find(d => d.id === id && d.organizationId === orgId());
      if (!doctor || !canPerformAction(get().currentUser, 'medicos', 'edit')) throw new Error('Você não possui permissão para alterar este cadastro.');
      const actor = get().currentUser.id;
      const updated = await cloud.setDoctorStatusInSupabase(doctor, status);
      if (get().currentUser.id !== actor || get().activeOrganizationId !== doctor.organizationId) return;
      set({ doctors: get().doctors.map(d => d.id === updated.id && d.organizationId === updated.organizationId ? updated : d) });
    }, { success: doctorStatusActions[status].success, description: 'Plantões e documentos preservados.' }),
    deleteDoctor: id => commit(async () => { await cloud.deleteDoctorFromSupabase(id); set({ doctors: get().doctors.filter(d => d.id !== id), documents: get().documents.filter(d => d.doctorId !== id), shifts: get().shifts.filter(s => s.doctorId !== id) }); }),
    addUnit: input => commit(async () => { const unit = { ...input, id: crypto.randomUUID(), organizationId: orgId() }; await cloud.saveUnitToSupabase(unit, true); set({ units: [...get().units, unit] }); }),
    updateUnit: (unit, feedback) => commit(async () => { await cloud.saveUnitToSupabase(unit); set({ units: get().units.map(u => u.id === unit.id ? unit : u) }); }, feedback),
    deleteUnit: id => commit(async () => { await cloud.deleteUnitFromSupabase(id); set({ units: get().units.filter(u => u.id !== id), sectors: get().sectors.filter(s => s.unitId !== id), shifts: get().shifts.filter(s => s.unitId !== id) }); }),
    addSector: async (input, finance, feedback) => {
      const sector = { ...input, id: crypto.randomUUID(), organizationId: orgId() };
      const saved = await commit(async () => { await cloud.saveSectorToSupabase(sector, true, finance); set({ sectors: [...get().sectors, sector] }); }, { success: 'Setor cadastrado.', inlineError: true, ...feedback });
      return saved ? sector : null;
    },
    updateSector: (sector, finance) => commit(async () => { await cloud.saveSectorToSupabase(sector, false, finance); set({ sectors: get().sectors.map(s => s.id === sector.id ? sector : s) }); }, { success: 'Setor atualizado.', inlineError: true }),
    deleteSector: id => commit(async () => { await cloud.deleteSectorFromSupabase(id); set({ sectors: get().sectors.filter(s => s.id !== id) }); }),
    addShift: (input, draftId) => {
      let message = input.doctorId ? 'Plantão cadastrado.' : 'Vaga cadastrada.';
      return commit(async () => {
        const shift = { ...input, id: input.cashPayment?.id || draftId || crypto.randomUUID(), organizationId: orgId() };
        const saved = input.coveragePlan ? await cloud.saveFractionalShiftToSupabase(shift) : [await cloud.saveShiftToSupabase(shift)];
        const savedIds = new Set(saved.map(item => item.id));
        const previous = get().shifts;
        message = coverageSaveMessage(message, saved, previous);
        set({ shifts: [...previous.filter(item => !savedIds.has(item.id)), ...saved] });
      }, { success: () => message, inlineError: true });
    },
    addShifts: (inputs, feedback) => commit(async () => {
      const saved = await cloud.saveShiftsToSupabase(inputs.map(input => ({ ...input, id: crypto.randomUUID(), organizationId: orgId() })));
      set({ shifts: [...get().shifts, ...saved] });
    }, { success: 'Plantões cadastrados.', inlineError: true, ...feedback }),
    updateShift: shift => {
      let message = shift.doctorId ? 'Plantão atualizado.' : 'Vaga atualizada.';
      return commit(async () => {
        if (shift.coveragePlan || shift.coveragePost) {
          const saved = await cloud.saveFractionalShiftToSupabase(shift);
          const id = shift.coveragePost?.id || shift.id;
          const previous = get().shifts;
          message = coverageSaveMessage(message, saved, previous);
          set({ shifts: [...previous.filter(item => item.id !== shift.id && item.coveragePost?.id !== id), ...saved] });
          return;
        }
        const saved = await cloud.saveShiftToSupabase(shift);
        set({ shifts: get().shifts.map(item => item.id === saved.id ? saved : item) });
      }, { success: () => message, inlineError: true });
    },
    saveCoverageDraft: (anchor, plan, changes) => {
      let message = 'Cobertura salva.';
      return commit(async () => {
        const saved = await cloud.saveCoverageDraftToSupabase(anchor, plan, changes);
        const id = anchor.coveragePost?.id || anchor.id;
        const savedIds = new Set(saved.map(item => item.id));
        const previous = get().shifts;
        message = coverageSaveMessage(message, saved, previous);
        set({ shifts: [...previous.filter(item => item.coveragePost?.id !== id && !savedIds.has(item.id)), ...saved] });
      }, { success: () => message, inlineError: true });
    },
    publishCoverage: (shift, enabled) => commit(async () => {
      if (!shift.coveragePost || shift.organizationId !== orgId() || !canEditPermission(get().currentUser, 'escala')) {
        throw new Error('Seu acesso não permite publicar esta vaga.');
      }
      await cloud.publishCoverageVacancy(shift.id, enabled);
      set({ shifts: get().shifts.map(item => item.id === shift.id && item.coveragePost ? {
        ...item, coveragePost: { ...item.coveragePost, published: enabled },
      } : item) });
    }, { success: enabled ? 'Vaga publicada no Portal Médico.' : 'Vaga retirada do Portal Médico.', inlineError: true, withinDialog: true }),
    cancelCoverage: shift => commit(async () => {
      const post = shift.coveragePost;
      if (!post || shift.organizationId !== orgId() || !canPerformAction(get().currentUser, 'escala', 'delete')) {
        throw new Error('Seu acesso não permite cancelar este posto.');
      }
      const saved = await cloud.cancelCoveragePost(post);
      set({ shifts: [...get().shifts.filter(item => item.coveragePost?.id !== post.id), ...saved] });
    }, { success: 'Posto cancelado.', inlineError: true }),
    updateShiftPayment: (id, status) => commit(async () => {
      const current = get().shifts.find(shift => shift.id === id && shift.organizationId === orgId());
      if (!current) throw new Error('Plantão não encontrado nesta empresa.');
      const updated = await cloud.updateShiftPaymentInSupabase(id, status);
      set({ shifts: get().shifts.map(shift => shift.id === id ? updated : shift) });
    }),
    updateShiftFinancials: (id, amount, frequency, status, settlement) => commit(async () => {
      const current = get().shifts.find(shift => shift.id === id && shift.organizationId === orgId());
      if (!current) throw new Error('Plantão não encontrado nesta empresa.');
      const updated = await cloud.updateShiftFinancialsInSupabase(id, amount, frequency, status, settlement);
      set({ shifts: get().shifts.map(shift => shift.id === id ? updated : shift) });
    }, { success: 'Pagamento atualizado.', inlineError: true, withinDialog: true }),
    updateShiftAgreement: (id, selection, adjustment) => commit(async () => {
      if (!get().shifts.some(shift => shift.id === id && shift.organizationId === orgId())) throw new Error('Plantão não encontrado nesta empresa.');
      const updated = await cloud.editShiftAgreement(id, selection, adjustment);
      set({ shifts: get().shifts.map(shift => shift.id === id ? updated : shift) });
    }, { success: 'Acordo atualizado.', inlineError: true, withinDialog: true }),
    deleteShift: id => commit(async () => { await cloud.deleteShiftFromSupabase(id); set({ shifts: get().shifts.filter(s => s.id !== id) }); }),
    deleteShifts: ids => commit(async () => {
      if (!canPerformAction(get().currentUser, 'escala', 'delete')) throw new Error('Seu acesso não permite excluir plantões.');
      const uniqueIds = [...new Set(ids)];
      const organizationId = orgId();
      if (!uniqueIds.length || uniqueIds.length > 500 || uniqueIds.some(id => !get().shifts.some(shift => shift.id === id && shift.organizationId === organizationId))) throw new Error('Selecione entre 1 e 500 plantões desta empresa.');
      if (uniqueIds.some(id => { const shift = get().shifts.find(item => item.id === id); return shift && (shift.paymentStatus === 'paid' || Number(shift.paymentAmount) > 0); }) && !canEditPermission(get().currentUser, 'financeiro')) throw new Error('Você não pode excluir plantões com dados financeiros.');
      try { await cloud.deleteShiftsFromSupabase(uniqueIds, organizationId); }
      catch (error) { try { get().syncWithCloud(await cloud.fetchInitialDataFromSupabase()); } catch { /* Keep the original error. */ } throw error; }
      const deleted = new Set(uniqueIds);
      set({ shifts: get().shifts.filter(shift => !deleted.has(shift.id)) });
    }, { success: 'Exclusão de plantões concluída.', inlineError: true }),
    vacateShifts: ids => commit(async () => {
      if (!canEditPermission(get().currentUser, 'escala')) throw new Error('Seu acesso permite apenas visualizar a escala.');
      const uniqueIds = [...new Set(ids)];
      const organizationId = orgId();
      const selected = uniqueIds.map(id => get().shifts.find(shift => shift.id === id && shift.organizationId === organizationId));
      if (!uniqueIds.length || uniqueIds.length > 500 || selected.some(shift => !shift?.doctorId)) throw new Error('Selecione entre 1 e 500 plantões com médico desta empresa.');
      if (selected.some(shift => shift && (shift.paymentStatus === 'paid' || Number(shift.paymentAmount) > 0)) && !canEditPermission(get().currentUser, 'financeiro')) throw new Error('Você não pode alterar plantões com dados financeiros.');
      const updated = selected.map(shift => vacateShift(shift!));
      let saved: Shift[];
      try { saved = await cloud.saveShiftsToSupabase(updated); }
      catch (error) { try { get().syncWithCloud(await cloud.fetchInitialDataFromSupabase()); } catch { /* Keep the original error. */ } throw error; }
      const postIds = [...new Set(saved.flatMap(item => item.coveragePost ? [item.coveragePost.id] : []))];
      if (postIds.length) {
        const siblings = await cloud.fetchCoverageShifts(organizationId, postIds);
        saved = [...saved.filter(item => !item.coveragePost), ...siblings];
      }
      const byId = new Map(saved.map(shift => [shift.id, shift]));
      set({ shifts: [...get().shifts.filter(shift => !byId.has(shift.id)), ...saved] });
    }, { success: 'Plantões liberados.', inlineError: true }),
    uploadDocument: (doctorId, type, file, options) => commit(async () => {
      const doctor = get().doctors.find(d => d.id === doctorId && d.organizationId === orgId());
      if (!doctor) throw new Error('Médico não encontrado nesta empresa.');
      const previous = get().documents.find(d => d.doctorId === doctorId && d.type === type);
      if (!previous) throw new Error('Atualize a pasta para localizar o documento antes de enviá-lo.');
      await sendMedicalDocument(previous.id, file, options);
      const saved = await cloud.loadUploadedDocumentFromSupabase(previous.id).catch(() => null);
      if (!saved) {
        notify.warning('Atualize a pasta para ver a nova versão.');
        return;
      }
      set({ documents: [...get().documents.filter(d => d.id !== saved.id), saved] });
      await refreshDocumentAudits();
    }, { success: false, progress: false }),
    updateDocumentStatus: (id, status) => commit(async () => { const previous = get().documents.find(d => d.id === id); if (!previous) throw new Error('Documento não encontrado.'); const saved = await cloud.saveDocumentToSupabase({ ...previous, status }); set({ documents: get().documents.map(d => d.id === id ? saved : d) }); await refreshDocumentAudits(); }, { success: 'Status do documento atualizado.' }),
    updateDocument: document => commit(async () => { const saved = await cloud.saveDocumentToSupabase(document); set({ documents: get().documents.map(item => item.id === document.id ? saved : item) }); await refreshDocumentAudits(); }, { success: 'Documento atualizado.' }),
    bulkUpdateDocuments: (documentIds, status, reviewNote) => commit(async () => {
      const idSet = new Set(documentIds);
      const selected = get().documents.filter(document => idSet.has(document.id) && document.organizationId === orgId());
      if (!selected.length) throw new Error('Selecione ao menos um documento desta empresa.');
      if (status === 'rejected' && !reviewNote?.trim()) throw new Error('Informe o motivo da reprovação.');
      const saved = await cloud.saveDocumentsToSupabase(selected.map(document => ({ ...document, status, reviewNote: reviewNote?.trim() || document.reviewNote })));
      const savedMap = new Map(saved.map(document => [document.id, document]));
      set({ documents: get().documents.map(document => savedMap.get(document.id) || document) });
      await refreshDocumentAudits();
    }, { success: 'Documentos atualizados.' }),
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
    updateOrganizationSettings: (id, updates, feedback) => commit(async () => {
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
    }, feedback),
    addUser: input => commit(async () => { const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível criar o acesso.'); set({ users: [...get().users, result.user] }); }, { inlineError: true }),
    updateUser: user => commit(async () => { const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível atualizar o acesso.'); set({ users: get().users.map(u => u.id === user.id ? result.user : u) }); }, { inlineError: true }),
    deleteUser: (id, confirmation) => commit(async () => { const res = await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, confirmation }) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível excluir o usuário.'); set({ users: get().users.filter(user => user.id !== id) }); }),
    setUserTemporaryPassword: (id, password) => commit(async () => { const res = await fetch('/api/admin/users/password', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password }) }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível atualizar a senha.'); }, { success: false }),
    updateProfile: form => commit(async () => { const res = await fetch('/api/profile', { method: 'POST', body: form }); const result = await res.json(); if (!res.ok) throw new Error(result.error || 'Não foi possível atualizar o perfil.'); if (get().currentUser.id === result.user.id) set({ currentUser: result.user, users: get().users.map(u => u.id === result.user.id ? result.user : u) }); }, { success: 'Perfil atualizado.', inlineError: true }),
    startSimulation: id => { if (get().currentUser.type === 'saas_admin' && get().organizations.some(o => o.id === id)) set({ isSimulating: true, simulatedOrganizationId: id, activeOrganizationId: id }); },
    stopSimulation: () => set({ isSimulating: false, simulatedOrganizationId: null }),
  };
}, {
  name: 'nv-med-preferences',
  skipHydration: true,
  partialize: state => ({ activeOrganizationId: state.activeOrganizationId }),
  merge: (saved, current) => ({
    ...current,
    theme: (saved as { theme?: string })?.theme === 'dark' ? 'dark' : 'light',
    activeOrganizationId: (saved as { activeOrganizationId?: string })?.activeOrganizationId || '',
    sidebarCollapsed: true,
  }),
}));
