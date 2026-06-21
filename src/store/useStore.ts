import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Organization, Doctor, Unit, MedicalDocument, Shift, DocumentStatus, DocumentType } from '../types';
import { mockOrganizations, mockDoctors, mockUnits, mockDocuments, mockShifts } from '../data/mockData';

interface VNMedState {
  activeOrganizationId: string;
  organizations: Organization[];
  doctors: Doctor[];
  units: Unit[];
  documents: MedicalDocument[];
  shifts: Shift[];
  
  // Auth simulation
  currentUser: {
    name: string;
    role: string;
    avatar?: string;
  };

  // Actions
  setActiveOrganizationId: (id: string) => void;
  
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
  updateOrganizationSettings: (orgId: string, updates: Partial<Organization>) => void;
  resetToMockData: () => void;
}

export const useStore = create<VNMedState>()(
  persist(
    (set, get) => ({
      activeOrganizationId: 'org-1',
      organizations: mockOrganizations,
      doctors: mockDoctors,
      units: mockUnits,
      documents: mockDocuments,
      shifts: mockShifts,
      currentUser: {
        name: 'Dr. Gabriel Moraes',
        role: 'Diretor Médico',
        avatar: ''
      },

      setActiveOrganizationId: (id) => set({ activeOrganizationId: id }),

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

      resetToMockData: () => set({
        activeOrganizationId: 'org-1',
        organizations: mockOrganizations,
        doctors: mockDoctors,
        units: mockUnits,
        documents: mockDocuments,
        shifts: mockShifts,
      })
    }),
    {
      name: 'vn-med-storage', // name of the item in the local storage
      skipHydration: true, // we will hydrate manually in a provider to avoid SSR mismatch
    }
  )
);
