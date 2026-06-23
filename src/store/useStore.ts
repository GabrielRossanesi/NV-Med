import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Organization, Doctor, Unit, MedicalDocument, Shift, DocumentStatus, DocumentType, UserAccount } from '../types';
import { mockOrganizations, mockDoctors, mockUnits, mockDocuments, mockShifts, mockUsers } from '../data/mockData';

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
      },

      updateDoctor: (updatedDoctor) => set((state) => ({
        doctors: state.doctors.map((d) => d.id === updatedDoctor.id ? updatedDoctor : d)
      })),

      deleteDoctor: (id) => set((state) => ({
        doctors: state.doctors.filter((d) => d.id !== id),
        // Clean up linked shifts and documents
        shifts: state.shifts.filter((s) => s.doctorId !== id),
        documents: state.documents.filter((d) => d.doctorId !== id),
      })),

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
      },

      updateUnit: (updatedUnit) => set((state) => ({
        units: state.units.map((u) => u.id === updatedUnit.id ? updatedUnit : u)
      })),

      deleteUnit: (id) => set((state) => ({
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
      })),

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
      },

      updateShift: (updatedShift) => set((state) => ({
        shifts: state.shifts.map((s) => s.id === updatedShift.id ? updatedShift : s)
      })),

      deleteShift: (id) => set((state) => ({
        shifts: state.shifts.filter((s) => s.id !== id)
      })),

      uploadDocument: (doctorId, type, fileName) => {
        const orgId = get().activeOrganizationId;
        set((state) => {
          // Check if document checklist item already exists for doctor
          const existingDocIndex = state.documents.findIndex(
            (d) => d.doctorId === doctorId && d.type === type
          );

          const todayStr = new Date().toISOString().split('T')[0];

          if (existingDocIndex >= 0) {
            const updatedDocs = [...state.documents];
            updatedDocs[existingDocIndex] = {
              ...updatedDocs[existingDocIndex],
              status: 'sent',
              fileName,
              uploadDate: todayStr,
            };
            return { documents: updatedDocs };
          } else {
            // Fallback: create a new one
            const newDoc: MedicalDocument = {
              id: `doc-${doctorId}-${type}-${Date.now()}`,
              doctorId,
              name: type.replace('_', ' ').toUpperCase(),
              type,
              status: 'sent',
              fileName,
              uploadDate: todayStr,
              organizationId: orgId,
            };
            return { documents: [...state.documents, newDoc] };
          }
        });
      },

      updateDocumentStatus: (documentId, status) => set((state) => ({
        documents: state.documents.map((d) => 
          d.id === documentId ? { ...d, status } : d
        )
      })),

      updateOrganizationSettings: (orgId, updates) => set((state) => ({
        organizations: state.organizations.map((org) => 
          org.id === orgId ? { ...org, ...updates } : org
        )
      })),

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
      },

      updateOrganization: (updatedOrg) => set((state) => ({
        organizations: state.organizations.map((org) => org.id === updatedOrg.id ? updatedOrg : org)
      })),

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
      },

      updateUser: (updatedUser) => set((state) => {
        const nextUsers = state.users.map((u) => u.id === updatedUser.id ? updatedUser : u);
        const isCurrent = state.currentUser.id === updatedUser.id;
        return {
          users: nextUsers,
          ...(isCurrent ? { currentUser: updatedUser } : {})
        };
      }),

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
