import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Organization, Doctor, Unit, MedicalDocument, Shift, DocumentStatus, DocumentType, UserAccount } from '../types';
import { mockOrganizations, mockDoctors, mockUnits, mockDocuments, mockShifts, mockUsers } from '../data/mockData';
import {
  saveDoctorToSupabase,
  deleteDoctorFromSupabase,
  saveUnitToSupabase,
  deleteUnitFromSupabase,
  saveShiftToSupabase,
  deleteShiftFromSupabase,
  saveDocumentToSupabase,
  saveOrganizationToSupabase,
  saveUserToSupabase
} from '@/services/supabaseService';

interface NVMedState {
  activeOrganizationId: string;
  organizations: Organization[];
  doctors: Doctor[];
  units: Unit[];
  documents: MedicalDocument[];
  shifts: Shift[];
  
  // Auth & Admin simulation
  currentUser: UserAccount;
  users: UserAccount[];
  isSimulating: boolean;
  simulatedOrganizationId: string | null;

  // Cloud sync
  syncWithCloud: (data: {
    organizations?: Organization[];
    doctors?: Doctor[];
    units?: Unit[];
    documents?: MedicalDocument[];
    shifts?: Shift[];
    users?: UserAccount[];
  }) => void;

  // Actions
  setActiveOrganizationId: (id: string) => void;
  setCurrentUser: (userId: string) => void;
  
  // Doctor CRUD
  addDoctor: (doctor: Omit<Doctor, 'id' | 'organizationId'>) => void;
  updateDoctor: (doctor: Doctor) => void;
  deleteDoctor: (id: string) => void;
  
  // Unit CRUD
  addUnit: (unit: Omit<Unit, 'id' | 'organizationId'>) => void;
  updateUnit: (unit: Unit) => void;
  deleteUnit: (id: string) => void;
  
  // Shift CRUD
  addShift: (shift: Omit<Shift, 'id' | 'organizationId'>) => void;
  updateShift: (shift: Shift) => void;
  deleteShift: (id: string) => void;
  
  // Document actions
  uploadDocument: (doctorId: string, type: DocumentType, fileName: string) => void;
  updateDocumentStatus: (documentId: string, status: DocumentStatus) => void;
  
  // Org actions
  addOrganization: (org: Omit<Organization, 'id'>) => void;
  updateOrganization: (org: Organization) => void;
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>) => void;
  resetToMockData: () => void;

  // User actions
  addUser: (user: Omit<UserAccount, 'id' | 'createdAt'>) => void;
  updateUser: (user: UserAccount) => void;

  // Simulation actions
  startSimulation: (orgId: string) => void;
  stopSimulation: () => void;
  
  // Theme state
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useStore = create<NVMedState>()(
  persist(
    (set, get) => ({
      activeOrganizationId: 'org-1',
      organizations: mockOrganizations,
      doctors: mockDoctors,
      units: mockUnits,
      documents: mockDocuments,
      shifts: mockShifts,
      users: mockUsers,
      currentUser: mockUsers[0], // Gabriel Moraes CEO
      isSimulating: false,
      simulatedOrganizationId: null,

      syncWithCloud: (data) => set((state) => ({
        organizations: data.organizations && data.organizations.length > 0 ? data.organizations : state.organizations,
        doctors: data.doctors && data.doctors.length > 0 ? data.doctors : state.doctors,
        units: data.units && data.units.length > 0 ? data.units : state.units,
        documents: data.documents && data.documents.length > 0 ? data.documents : state.documents,
        shifts: data.shifts && data.shifts.length > 0 ? data.shifts : state.shifts,
        users: data.users && data.users.length > 0 ? data.users : state.users,
      })),

      setActiveOrganizationId: (id) => set({ activeOrganizationId: id }),

      setCurrentUser: (userId) => {
        const user = get().users.find((u) => u.id === userId);
        if (user) {
          const updates: Partial<NVMedState> = {
            currentUser: user,
            // If they are tenant_user, force to their organization and turn off simulation
            ...(user.type === 'tenant_user' ? {
              activeOrganizationId: user.organizationId || 'org-1',
              isSimulating: false,
              simulatedOrganizationId: null
            } : {})
          };
          set(updates);
        }
      },

      addDoctor: (doctorData) => {
        const orgId = get().activeOrganizationId;
        const newId = `doc-${Date.now()}`;
        const newDoctor: Doctor = {
          ...doctorData,
          id: newId,
          organizationId: orgId,
        };

        // Auto-generate document templates for the doctor based on organization settings
        const org = get().organizations.find((o) => o.id === orgId);
        const requiredDocs = org?.settings.requiredDocuments || [];
        const newDocs: MedicalDocument[] = requiredDocs.map((doc, index) => ({
          id: `doc-${newId}-${index}-${Date.now()}`,
          doctorId: newId,
          name: doc.name,
          type: doc.type as DocumentType,
          status: 'not_sent',
          organizationId: orgId,
        }));

        set((state) => ({
          doctors: [...state.doctors, newDoctor],
          documents: [...state.documents, ...newDocs],
        }));

        // Persistência em nuvem (Supabase)
        saveDoctorToSupabase(newDoctor).catch((err) => console.warn('[Supabase Sync Error]', err));
        newDocs.forEach((d) => saveDocumentToSupabase(d).catch((err) => console.warn('[Supabase Sync Error]', err)));
      },

      updateDoctor: (updatedDoctor) => {
        set((state) => ({
          doctors: state.doctors.map((d) => d.id === updatedDoctor.id ? updatedDoctor : d)
        }));
        saveDoctorToSupabase(updatedDoctor).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      deleteDoctor: (id) => {
        set((state) => ({
          doctors: state.doctors.filter((d) => d.id !== id),
          // Clean up linked shifts and documents
          shifts: state.shifts.filter((s) => s.doctorId !== id),
          documents: state.documents.filter((d) => d.doctorId !== id),
        }));
        deleteDoctorFromSupabase(id).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      addUnit: (unitData) => {
        const orgId = get().activeOrganizationId;
        const newId = `unit-${Date.now()}`;
        const newUnit: Unit = {
          ...unitData,
          id: newId,
          organizationId: orgId,
        };
        set((state) => ({
          units: [...state.units, newUnit]
        }));
        saveUnitToSupabase(newUnit).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      updateUnit: (updatedUnit) => {
        set((state) => ({
          units: state.units.map((u) => u.id === updatedUnit.id ? updatedUnit : u)
        }));
        saveUnitToSupabase(updatedUnit).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      deleteUnit: (id) => {
        set((state) => ({
          units: state.units.filter((u) => u.id !== id),
          // Clean up linked shifts
          shifts: state.shifts.filter((s) => s.unitId !== id),
          // Update doctors that might be linked
          doctors: state.doctors.map((doc) => {
            if (doc.linkedUnits.includes(id)) {
              return { ...doc, linkedUnits: doc.linkedUnits.filter((uid) => uid !== id) };
            }
            return doc;
          }),
        }));
        deleteUnitFromSupabase(id).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      addShift: (shiftData) => {
        const orgId = get().activeOrganizationId;
        const newId = `shift-${Date.now()}`;
        const newShift: Shift = {
          ...shiftData,
          id: newId,
          organizationId: orgId,
        };
        set((state) => ({
          shifts: [...state.shifts, newShift]
        }));
        saveShiftToSupabase(newShift).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      updateShift: (updatedShift) => {
        set((state) => ({
          shifts: state.shifts.map((s) => s.id === updatedShift.id ? updatedShift : s)
        }));
        saveShiftToSupabase(updatedShift).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      deleteShift: (id) => {
        set((state) => ({
          shifts: state.shifts.filter((s) => s.id !== id)
        }));
        deleteShiftFromSupabase(id).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      uploadDocument: (doctorId, type, fileName) => {
        const orgId = get().activeOrganizationId;
        const todayStr = new Date().toISOString().split('T')[0];

        let targetDoc: MedicalDocument | null = null;

        set((state) => {
          const existingDocIndex = state.documents.findIndex(
            (d) => d.doctorId === doctorId && d.type === type
          );

          if (existingDocIndex >= 0) {
            const updatedDocs = [...state.documents];
            targetDoc = {
              ...updatedDocs[existingDocIndex],
              status: 'sent',
              fileName,
              uploadDate: todayStr,
            };
            updatedDocs[existingDocIndex] = targetDoc;
            return { documents: updatedDocs };
          } else {
            targetDoc = {
              id: `doc-${doctorId}-${type}-${Date.now()}`,
              doctorId,
              name: type.replace('_', ' ').toUpperCase(),
              type,
              status: 'sent',
              fileName,
              uploadDate: todayStr,
              organizationId: orgId,
            };
            return { documents: [...state.documents, targetDoc] };
          }
        });

        if (targetDoc) {
          saveDocumentToSupabase(targetDoc).catch((err) => console.warn('[Supabase Sync Error]', err));
        }
      },

      updateDocumentStatus: (documentId, status) => {
        let updatedDoc: MedicalDocument | null = null;
        set((state) => {
          const docs = state.documents.map((d) => {
            if (d.id === documentId) {
              updatedDoc = { ...d, status };
              return updatedDoc;
            }
            return d;
          });
          return { documents: docs };
        });

        if (updatedDoc) {
          saveDocumentToSupabase(updatedDoc).catch((err) => console.warn('[Supabase Sync Error]', err));
        }
      },

      updateOrganizationSettings: (orgId, updates) => {
        let updatedOrg: Organization | null = null;
        set((state) => ({
          organizations: state.organizations.map((org) => {
            if (org.id === orgId) {
              updatedOrg = { ...org, ...updates };
              return updatedOrg;
            }
            return org;
          })
        }));

        if (updatedOrg) {
          saveOrganizationToSupabase(updatedOrg).catch((err) => console.warn('[Supabase Sync Error]', err));
        }
      },

      addOrganization: (orgData) => {
        const newId = `org-${Date.now()}`;
        const newOrg: Organization = {
          ...orgData,
          id: newId,
          settings: orgData.settings || {
            specialties: ['Clínico Geral'],
            requiredDocuments: [
              { type: 'rg_cnh', name: 'RG/CNH', required: true },
              { type: 'diploma_medicina', name: 'Diploma de Medicina', required: true }
            ]
          }
        };
        set((state) => ({
          organizations: [...state.organizations, newOrg]
        }));
        saveOrganizationToSupabase(newOrg).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      updateOrganization: (updatedOrg) => {
        set((state) => ({
          organizations: state.organizations.map((org) => org.id === updatedOrg.id ? updatedOrg : org)
        }));
        saveOrganizationToSupabase(updatedOrg).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      addUser: (userData) => {
        const newId = `user-${Date.now()}`;
        const newUser: UserAccount = {
          ...userData,
          id: newId,
          createdAt: new Date().toISOString().split('T')[0]
        };
        set((state) => ({
          users: [...state.users, newUser]
        }));
        saveUserToSupabase(newUser).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      updateUser: (updatedUser) => {
        set((state) => {
          const nextUsers = state.users.map((u) => u.id === updatedUser.id ? updatedUser : u);
          const isCurrent = state.currentUser.id === updatedUser.id;
          return {
            users: nextUsers,
            ...(isCurrent ? { currentUser: updatedUser } : {})
          };
        });
        saveUserToSupabase(updatedUser).catch((err) => console.warn('[Supabase Sync Error]', err));
      },

      startSimulation: (orgId) => {
        const org = get().organizations.find((o) => o.id === orgId);
        if (org) {
          set({
            isSimulating: true,
            simulatedOrganizationId: orgId,
            activeOrganizationId: orgId
          });
        }
      },

      stopSimulation: () => {
        set({
          isSimulating: false,
          simulatedOrganizationId: null,
          activeOrganizationId: 'org-1'
        });
      },

      resetToMockData: () => set({
        activeOrganizationId: 'org-1',
        organizations: mockOrganizations,
        doctors: mockDoctors,
        units: mockUnits,
        documents: mockDocuments,
        shifts: mockShifts,
        users: mockUsers,
        currentUser: mockUsers[0],
        isSimulating: false,
        simulatedOrganizationId: null,
      }),

      // Theme implementation
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'nv-med-storage', // name of the item in the local storage
      skipHydration: true, // we will hydrate manually in a provider to avoid SSR mismatch
    }
  )
);
