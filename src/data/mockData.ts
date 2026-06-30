import { Organization, Doctor, Unit, MedicalDocument, Shift, UserAccount } from '../types';

export const mockOrganizations: Organization[] = [
  {
    id: 'org-1',
    name: 'NV Med Operadora Demo',
    razaoSocial: 'NV Med Gestão e Serviços Médicos Ltda',
    cnpj: '12.345.678/0001-90',
    phone: '(11) 98888-7777',
    email: 'contato@nvmed.com.br',
    address: 'Av. Paulista, 1000, Bela Vista, São Paulo - SP',
    responsavelName: 'Ana Souza',
    responsavelRole: 'Diretora',
    city: 'São Paulo',
    state: 'SP',
    plan: 'platinum',
    status: 'active',
    enabledModules: ['Dashboard', 'Médicos', 'Unidades', 'Documentos', 'Escala', 'Configurações', 'Relatórios'],
    createdAt: '2025-01-10',
    lastActive: '2026-06-22',
    settings: {
      specialties: [
        'Clínico Geral',
        'Cardiologia',
        'Pediatria',
        'Ginecologia',
        'Ortopedia',
        'Dermatologia',
        'Anestesiologia'
      ],
      requiredDocuments: [
        { type: 'rg_cnh', name: 'RG/CNH', required: true },
        { type: 'diploma_medicina', name: 'Diploma de Medicina', required: true },
        { type: 'diploma_residencia', name: 'Diploma de Residência ou Pós-graduação', required: true },
        { type: 'comprovante_residencia', name: 'Comprovante de endereço residencial', required: true },
        { type: 'certidao_crm_etica', name: 'Certidão Ética CRM', required: true },
        { type: 'certidao_crm_financeira', name: 'Certidão Financeira CRM', required: true }
      ]
    }
  },
  {
    id: 'org-2',
    name: 'Clínica Norte Saúde',
    razaoSocial: 'Norte Saúde Assistência Médica S/A',
    cnpj: '98.765.432/0001-10',
    phone: '(85) 3245-8800',
    email: 'gerencia@nortesaude.com.br',
    address: 'Av. Santos Dumont, 1000, Aldeota, Fortaleza - CE',
    responsavelName: 'Carla Rocha',
    responsavelRole: 'Gerente',
    city: 'Fortaleza',
    state: 'CE',
    plan: 'gold',
    status: 'active',
    enabledModules: ['Dashboard', 'Médicos', 'Unidades', 'Documentos', 'Escala'],
    createdAt: '2025-03-01',
    lastActive: '2026-06-21',
    settings: {
      specialties: [
        'Clínico Geral',
        'Ortopedia',
        'Dermatologia',
        'Oftalmologia',
        'Pediatria'
      ],
      requiredDocuments: [
        { type: 'rg_cnh', name: 'RG/CNH', required: true },
        { type: 'diploma_medicina', name: 'Diploma de Medicina', required: true },
        { type: 'comprovante_residencia', name: 'Comprovante de endereço residencial', required: true },
        { type: 'certidao_crm_etica', name: 'Certidão Ética CRM', required: true }
      ]
    }
  },
  {
    id: 'org-3',
    name: 'Hospital São Lucas',
    razaoSocial: 'Sociedade Beneficente São Lucas',
    cnpj: '45.678.901/0001-22',
    phone: '(11) 3012-9900',
    email: 'coordenacao@hospitalsaolucas.com.br',
    address: 'Rua Vergueiro, 3000, Vila Mariana, São Paulo - SP',
    responsavelName: 'Renata Lima',
    responsavelRole: 'Coordenadora',
    city: 'São Paulo',
    state: 'SP',
    plan: 'silver',
    status: 'setup',
    enabledModules: ['Dashboard', 'Médicos', 'Unidades', 'Escala'],
    createdAt: '2026-02-15',
    lastActive: '2026-06-20',
    settings: {
      specialties: [
        'Clínico Geral',
        'Cardiologia',
        'Pediatria',
        'Neurologia',
        'Anestesiologia',
        'Traumatologia',
        'Ginecologia'
      ],
      requiredDocuments: [
        { type: 'rg_cnh', name: 'RG/CNH', required: true },
        { type: 'diploma_medicina', name: 'Diploma de Medicina', required: true },
        { type: 'diploma_residencia', name: 'Diploma de Residência ou Pós-graduação', required: true },
        { type: 'comprovante_residencia', name: 'Comprovante de endereço residencial', required: true },
        { type: 'certidao_crm_etica', name: 'Certidão Ética CRM', required: true },
        { type: 'certidao_crm_financeira', name: 'Certidão Financeira CRM', required: true }
      ]
    }
  }
];

export const mockUnits: Unit[] = [
  // Org 1 Units
  {
    id: 'unit-1',
    name: 'Pronto Atendimento NV Med Paulista',
    cnpj: '12.345.678/0001-90',
    address: 'Av. Paulista, 1000',
    city: 'São Paulo',
    state: 'SP',
    type: 'er',
    manager: 'Marcos Ribeiro',
    phone: '(11) 98888-7777',
    status: 'active',
    specialties: ['Clínico Geral', 'Pediatria', 'Ortopedia'],
    organizationId: 'org-1'
  },
  {
    id: 'unit-2',
    name: 'Hospital NV Med Pinheiros',
    cnpj: '12.345.678/0002-88',
    address: 'Rua dos Pinheiros, 500',
    city: 'São Paulo',
    state: 'SP',
    type: 'hospital',
    manager: 'Luisa Albuquerque',
    phone: '(11) 97777-6666',
    status: 'active',
    specialties: ['Cardiologia', 'Clínico Geral', 'Ginecologia', 'Anestesiologia', 'Dermatologia'],
    organizationId: 'org-1'
  },
  // Org 2 Units
  {
    id: 'unit-3',
    name: 'Clínica Norte Saúde Lourdes',
    cnpj: '98.765.432/0001-10',
    address: 'Av. Norte, 1500',
    city: 'Belo Horizonte',
    state: 'MG',
    type: 'clinic',
    manager: 'Claudio Neves',
    phone: '(31) 96666-5555',
    status: 'active',
    specialties: ['Ortopedia', 'Clínico Geral', 'Pediatria'],
    organizationId: 'org-2'
  },
  {
    id: 'unit-4',
    name: 'Pronto Atendimento Norte Pampulha',
    cnpj: '98.765.432/0003-20',
    address: 'Av. Antonio Carlos, 6000',
    city: 'Belo Horizonte',
    state: 'MG',
    type: 'er',
    manager: 'Patricia Lima',
    phone: '(31) 95555-4444',
    status: 'active',
    specialties: ['Clínico Geral', 'Dermatologia', 'Oftalmologia'],
    organizationId: 'org-2'
  },
  // Org 3 Units
  {
    id: 'unit-5',
    name: 'Hospital São Lucas Central',
    cnpj: '45.678.901/0001-22',
    address: 'Rua São Lucas, 12',
    city: 'Curitiba',
    state: 'PR',
    type: 'hospital',
    manager: 'Dr. Geraldo Alckmin',
    phone: '(41) 94444-3333',
    status: 'active',
    specialties: ['Neurologia', 'Anestesiologia', 'Cardiologia', 'Clínico Geral', 'Ginecologia'],
    organizationId: 'org-3'
  },
  {
    id: 'unit-6',
    name: 'UPA São Lucas Portão',
    cnpj: '45.678.901/0002-11',
    address: 'Av. República Argentina, 2500',
    city: 'Curitiba',
    state: 'PR',
    type: 'upa',
    manager: 'Sandra de Anchieta',
    phone: '(41) 93333-2222',
    status: 'active',
    specialties: ['Clínico Geral', 'Pediatria', 'Traumatologia'],
    organizationId: 'org-3'
  }
];

export const mockDoctors: Doctor[] = [
  // Org 1 Doctors
  {
    id: 'doc-1',
    name: 'Dr. Carlos Eduardo Silva',
    crm: '123456',
    crmUf: 'SP',
    cpf: '123.456.789-00',
    phone: '(11) 99123-4567',
    email: 'carlos.silva@nvmed.com.br',
    specialty: 'Cardiologia',
    address: 'Av. Rebouças, 1200, Ap 52 - Pinheiros, São Paulo - SP',
    status: 'active',
    linkedUnits: ['unit-1', 'unit-2'],
    organizationId: 'org-1'
  },
  {
    id: 'doc-2',
    name: 'Dra. Mariana Costa Martins',
    crm: '789012',
    crmUf: 'SP',
    cpf: '987.654.321-11',
    phone: '(11) 99876-5432',
    email: 'mariana.costa@nvmed.com.br',
    specialty: 'Pediatria',
    address: 'Rua Pamplona, 800 - Jardim Paulista, São Paulo - SP',
    status: 'pending',
    linkedUnits: ['unit-1'],
    organizationId: 'org-1'
  },
  {
    id: 'doc-3',
    name: 'Dr. Roberto Alencar de Melo',
    crm: '345678',
    crmUf: 'SP',
    cpf: '456.789.123-22',
    phone: '(11) 99456-7890',
    email: 'roberto.alencar@nvmed.com.br',
    specialty: 'Clínico Geral',
    address: 'Rua Bela Cintra, 2300 - Consolação, São Paulo - SP',
    status: 'active',
    linkedUnits: ['unit-2'],
    organizationId: 'org-1'
  },
  // Org 2 Doctors
  {
    id: 'doc-4',
    name: 'Dra. Juliana Fernandes Ribeiro',
    crm: '901234',
    crmUf: 'MG',
    cpf: '234.567.890-33',
    phone: '(31) 98765-1234',
    email: 'juliana.fernandes@nortesaude.com.br',
    specialty: 'Ortopedia',
    address: 'Rua da Bahia, 1400 - Centro, Belo Horizonte - MG',
    status: 'active',
    linkedUnits: ['unit-3'],
    organizationId: 'org-2'
  },
  {
    id: 'doc-5',
    name: 'Dr. Felipe Santos Oliveira',
    crm: '567890',
    crmUf: 'MG',
    cpf: '345.678.901-44',
    phone: '(31) 98877-6655',
    email: 'felipe.santos@nortesaude.com.br',
    specialty: 'Dermatologia',
    address: 'Rua Paraíba, 900 - Savassi, Belo Horizonte - MG',
    status: 'inactive',
    linkedUnits: ['unit-4'],
    organizationId: 'org-2'
  },
  // Org 3 Doctors
  {
    id: 'doc-6',
    name: 'Dra. Beatrice Souza de Paula',
    crm: '234567',
    crmUf: 'PR',
    cpf: '567.890.123-55',
    phone: '(41) 99111-2222',
    email: 'beatrice.souza@saolucas.com.br',
    specialty: 'Neurologia',
    address: 'Rua XV de Novembro, 1200 - Centro, Curitiba - PR',
    status: 'active',
    linkedUnits: ['unit-5'],
    organizationId: 'org-3'
  },
  {
    id: 'doc-7',
    name: 'Dr. Arthur Pendragon Silva',
    crm: '876543',
    crmUf: 'PR',
    cpf: '678.901.234-66',
    phone: '(41) 99222-3333',
    email: 'arthur.p@saolucas.com.br',
    specialty: 'Anestesiologia',
    address: 'Av. Sete de Setembro, 3400 - Batel, Curitiba - PR',
    status: 'active',
    linkedUnits: ['unit-5', 'unit-6'],
    organizationId: 'org-3'
  },
  {
    id: 'doc-8',
    name: 'Dra. Helena Troia Medeiros',
    crm: '432109',
    crmUf: 'PR',
    cpf: '789.012.345-77',
    phone: '(41) 99333-4444',
    email: 'helena.troia@saolucas.com.br',
    specialty: 'Cardiologia',
    address: 'Rua Padre Anchieta, 1500 - Bigorrilho, Curitiba - PR',
    status: 'pending',
    linkedUnits: ['unit-6'],
    organizationId: 'org-3'
  }
];

export const mockDocuments: MedicalDocument[] = [
  // Carlos Eduardo Silva (org-1) - ALL APPROVED
  { id: 'doc-1-1', doctorId: 'doc-1', name: 'RG/CNH', type: 'rg_cnh', status: 'approved', uploadDate: '2026-01-10', fileName: 'rg_carlos_silva.pdf', organizationId: 'org-1' },
  { id: 'doc-1-2', doctorId: 'doc-1', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'approved', uploadDate: '2026-01-10', fileName: 'diploma_medicina_carlos.pdf', organizationId: 'org-1' },
  { id: 'doc-1-3', doctorId: 'doc-1', name: 'Diploma de Residência ou Pós-graduação', type: 'diploma_residencia', status: 'approved', uploadDate: '2026-01-12', fileName: 'residencia_cardio_carlos.pdf', organizationId: 'org-1' },
  { id: 'doc-1-4', doctorId: 'doc-1', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'approved', uploadDate: '2026-05-15', fileName: 'comprovante_res_carlos.pdf', expiryDate: '2026-11-15', organizationId: 'org-1' },
  { id: 'doc-1-5', doctorId: 'doc-1', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'approved', uploadDate: '2026-02-20', fileName: 'certidao_crm_etica_carlos.pdf', expiryDate: '2027-02-20', organizationId: 'org-1' },
  { id: 'doc-1-6', doctorId: 'doc-1', name: 'Certidão Financeira CRM', type: 'certidao_crm_financeira', status: 'approved', uploadDate: '2026-02-20', fileName: 'certidao_crm_financeira_carlos.pdf', expiryDate: '2027-02-20', organizationId: 'org-1' },

  // Mariana Costa Martins (org-1) - PENDING/PROBLEMATIC
  { id: 'doc-2-1', doctorId: 'doc-2', name: 'RG/CNH', type: 'rg_cnh', status: 'approved', uploadDate: '2026-06-01', fileName: 'rg_mariana_costa.pdf', organizationId: 'org-1' },
  { id: 'doc-2-2', doctorId: 'doc-2', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'analyzing', uploadDate: '2026-06-18', fileName: 'diploma_mariana_crm.pdf', organizationId: 'org-1' },
  { id: 'doc-2-3', doctorId: 'doc-2', name: 'Diploma de Residência ou Pós-graduação', type: 'diploma_residencia', status: 'not_sent', organizationId: 'org-1' },
  { id: 'doc-2-4', doctorId: 'doc-2', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'expired', uploadDate: '2025-12-01', fileName: 'comprovante_antigo_mariana.pdf', expiryDate: '2026-03-01', organizationId: 'org-1' },
  { id: 'doc-2-5', doctorId: 'doc-2', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'rejected', uploadDate: '2026-05-10', fileName: 'certidao_errada.pdf', organizationId: 'org-1' },
  { id: 'doc-2-6', doctorId: 'doc-2', name: 'Certidão Financeira CRM', type: 'certidao_crm_financeira', status: 'not_sent', organizationId: 'org-1' },

  // Roberto Alencar de Melo (org-1) - MIXED
  { id: 'doc-3-1', doctorId: 'doc-3', name: 'RG/CNH', type: 'rg_cnh', status: 'approved', uploadDate: '2026-02-15', fileName: 'cnh_roberto_alencar.pdf', organizationId: 'org-1' },
  { id: 'doc-3-2', doctorId: 'doc-3', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'approved', uploadDate: '2026-02-15', fileName: 'diploma_roberto.pdf', organizationId: 'org-1' },
  { id: 'doc-3-3', doctorId: 'doc-3', name: 'Diploma de Residência ou Pós-graduação', type: 'diploma_residencia', status: 'approved', uploadDate: '2026-02-16', fileName: 'pos_roberto.pdf', organizationId: 'org-1' },
  { id: 'doc-3-4', doctorId: 'doc-3', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'approved', uploadDate: '2026-04-10', fileName: 'comprovante_roberto.pdf', expiryDate: '2026-10-10', organizationId: 'org-1' },
  { id: 'doc-3-5', doctorId: 'doc-3', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'expired', uploadDate: '2025-05-15', fileName: 'crm_etica_roberto.pdf', expiryDate: '2026-05-15', organizationId: 'org-1' },
  { id: 'doc-3-6', doctorId: 'doc-3', name: 'Certidão Financeira CRM', type: 'certidao_crm_financeira', status: 'approved', uploadDate: '2026-04-10', fileName: 'crm_fin_roberto.pdf', expiryDate: '2027-04-10', organizationId: 'org-1' },

  // Juliana Fernandes Ribeiro (org-2) - ALL APPROVED
  { id: 'doc-4-1', doctorId: 'doc-4', name: 'RG/CNH', type: 'rg_cnh', status: 'approved', uploadDate: '2026-03-01', fileName: 'rg_juliana.pdf', organizationId: 'org-2' },
  { id: 'doc-4-2', doctorId: 'doc-4', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'approved', uploadDate: '2026-03-01', fileName: 'diploma_juliana.pdf', organizationId: 'org-2' },
  { id: 'doc-4-4', doctorId: 'doc-4', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'approved', uploadDate: '2026-06-01', fileName: 'luz_juliana.pdf', expiryDate: '2026-12-01', organizationId: 'org-2' },
  { id: 'doc-4-5', doctorId: 'doc-4', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'approved', uploadDate: '2026-03-10', fileName: 'crm_etica_juliana.pdf', expiryDate: '2027-03-10', organizationId: 'org-2' },

  // Felipe Santos Oliveira (org-2) - PENDING
  { id: 'doc-5-1', doctorId: 'doc-5', name: 'RG/CNH', type: 'rg_cnh', status: 'approved', uploadDate: '2026-04-20', fileName: 'cnh_felipe.pdf', organizationId: 'org-2' },
  { id: 'doc-5-2', doctorId: 'doc-5', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'analyzing', uploadDate: '2026-06-20', fileName: 'diploma_felipe_santos.pdf', organizationId: 'org-2' },
  { id: 'doc-5-4', doctorId: 'doc-5', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'not_sent', organizationId: 'org-2' },
  { id: 'doc-5-5', doctorId: 'doc-5', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'expired', uploadDate: '2025-04-20', fileName: 'etica_felipe_2025.pdf', expiryDate: '2026-04-20', organizationId: 'org-2' },

  // Beatrice Souza de Paula (org-3) - ALL APPROVED
  { id: 'doc-6-1', doctorId: 'doc-6', name: 'RG/CNH', type: 'rg_cnh', status: 'approved', uploadDate: '2026-02-10', fileName: 'rg_beatrice.pdf', organizationId: 'org-3' },
  { id: 'doc-6-2', doctorId: 'doc-6', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'approved', uploadDate: '2026-02-10', fileName: 'diploma_beatrice.pdf', organizationId: 'org-3' },
  { id: 'doc-6-3', doctorId: 'doc-6', name: 'Diploma de Residência ou Pós-graduação', type: 'diploma_residencia', status: 'approved', uploadDate: '2026-02-12', fileName: 'neuro_residencia.pdf', organizationId: 'org-3' },
  { id: 'doc-6-4', doctorId: 'doc-6', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'approved', uploadDate: '2026-05-10', fileName: 'luz_beatrice.pdf', expiryDate: '2026-11-10', organizationId: 'org-3' },
  { id: 'doc-6-5', doctorId: 'doc-6', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'approved', uploadDate: '2026-02-28', fileName: 'etica_crm_beatrice.pdf', expiryDate: '2027-02-28', organizationId: 'org-3' },
  { id: 'doc-6-6', doctorId: 'doc-6', name: 'Certidão Financeira CRM', type: 'certidao_crm_financeira', status: 'approved', uploadDate: '2026-02-28', fileName: 'fin_crm_beatrice.pdf', expiryDate: '2027-02-28', organizationId: 'org-3' },

  // Arthur Pendragon Silva (org-3) - CRITICAL PENDING
  { id: 'doc-7-1', doctorId: 'doc-7', name: 'RG/CNH', type: 'rg_cnh', status: 'approved', uploadDate: '2026-01-15', fileName: 'rg_arthur.pdf', organizationId: 'org-3' },
  { id: 'doc-7-2', doctorId: 'doc-7', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'approved', uploadDate: '2026-01-15', fileName: 'diploma_arthur.pdf', organizationId: 'org-3' },
  { id: 'doc-7-3', doctorId: 'doc-7', name: 'Diploma de Residência ou Pós-graduação', type: 'diploma_residencia', status: 'approved', uploadDate: '2026-01-18', fileName: 'anestesia_arthur.pdf', organizationId: 'org-3' },
  { id: 'doc-7-4', doctorId: 'doc-7', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'expired', uploadDate: '2025-11-01', fileName: 'comprovante_velho_arthur.pdf', expiryDate: '2026-02-01', organizationId: 'org-3' },
  { id: 'doc-7-5', doctorId: 'doc-7', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'rejected', uploadDate: '2026-06-01', fileName: 'doc_invalido_arthur.pdf', organizationId: 'org-3' },
  { id: 'doc-7-6', doctorId: 'doc-7', name: 'Certidão Financeira CRM', type: 'certidao_crm_financeira', status: 'not_sent', organizationId: 'org-3' },

  // Helena Troia Medeiros (org-3) - NEW DOCTOR CHECKLIST
  { id: 'doc-8-1', doctorId: 'doc-8', name: 'RG/CNH', type: 'rg_cnh', status: 'analyzing', uploadDate: '2026-06-20', fileName: 'rg_helena.pdf', organizationId: 'org-3' },
  { id: 'doc-8-2', doctorId: 'doc-8', name: 'Diploma de Medicina', type: 'diploma_medicina', status: 'analyzing', uploadDate: '2026-06-20', fileName: 'diploma_med_helena.pdf', organizationId: 'org-3' },
  { id: 'doc-8-3', doctorId: 'doc-8', name: 'Diploma de Residência ou Pós-graduação', type: 'diploma_residencia', status: 'not_sent', organizationId: 'org-3' },
  { id: 'doc-8-4', doctorId: 'doc-8', name: 'Comprovante de endereço residencial', type: 'comprovante_residencia', status: 'not_sent', organizationId: 'org-3' },
  { id: 'doc-8-5', doctorId: 'doc-8', name: 'Certidão Ética CRM', type: 'certidao_crm_etica', status: 'not_sent', organizationId: 'org-3' },
  { id: 'doc-8-6', doctorId: 'doc-8', name: 'Certidão Financeira CRM', type: 'certidao_crm_financeira', status: 'not_sent', organizationId: 'org-3' }
];

export const mockShifts: Shift[] = [
  // ORG 1 SHIFTS (NV Med Operadora Demo)
  // Historical Shifts (June 2026)
  { id: 'shift-1-h1', doctorId: 'doc-1', unitId: 'unit-1', date: '2026-06-15', startTime: '08:00', endTime: '20:00', type: 'onsite', status: 'completed', notes: 'Plantão histórico Pronto Atendimento', organizationId: 'org-1' },
  { id: 'shift-1-h2', doctorId: 'doc-3', unitId: 'unit-2', date: '2026-06-16', startTime: '19:00', endTime: '07:00', type: 'onsite', status: 'completed', notes: 'Plantão histórico Noturno UTI', organizationId: 'org-1' },
  { id: 'shift-1-h3', doctorId: 'doc-1', unitId: 'unit-2', date: '2026-06-18', startTime: '08:00', endTime: '18:00', type: 'onsite', status: 'completed', notes: 'Plantão histórico UTI Coronária', organizationId: 'org-1' },
  { id: 'shift-1-h4', doctorId: 'doc-3', unitId: 'unit-1', date: '2026-06-20', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'completed', notes: 'Plantão histórico Clínico Geral', organizationId: 'org-1' },
  // Shifts for June 2026 (Active)
  { id: 'shift-1-1', doctorId: 'doc-1', unitId: 'unit-2', date: '2026-06-21', startTime: '08:00', endTime: '18:00', type: 'onsite', status: 'completed', notes: 'Plantão diurno UTI Geral', organizationId: 'org-1' },
  { id: 'shift-1-2', doctorId: 'doc-3', unitId: 'unit-1', date: '2026-06-21', startTime: '19:00', endTime: '07:00', type: 'onsite', status: 'confirmed', notes: 'Plantão noturno Pronto Atendimento', organizationId: 'org-1' },
  { id: 'shift-1-3', doctorId: 'doc-1', unitId: 'unit-1', date: '2026-06-22', startTime: '08:00', endTime: '14:00', type: 'telemedicine', status: 'pending', notes: 'Telemedicina Cardiologia', organizationId: 'org-1' },
  { id: 'shift-1-4', doctorId: 'doc-2', unitId: 'unit-1', date: '2026-06-22', startTime: '13:00', endTime: '19:00', type: 'onsite', status: 'confirmed', notes: 'Plantão Pediatria Ambulatório', organizationId: 'org-1' },
  { id: 'shift-1-5', doctorId: 'doc-3', unitId: 'unit-2', date: '2026-06-24', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'confirmed', notes: 'Plantão Enfermaria', organizationId: 'org-1' },
  { id: 'shift-1-6', doctorId: 'doc-1', unitId: 'unit-2', date: '2026-06-25', startTime: '08:00', endTime: '20:00', type: 'oncall', status: 'confirmed', notes: 'Sobreaviso Cardiologia', organizationId: 'org-1' },
  { id: 'shift-1-7', doctorId: 'doc-2', unitId: 'unit-1', date: '2026-06-26', startTime: '08:00', endTime: '20:00', type: 'onsite', status: 'pending', notes: 'Pediatria Emergência', organizationId: 'org-1' },
  { id: 'shift-1-8', doctorId: 'doc-1', unitId: 'unit-2', date: '2026-06-27', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'confirmed', notes: 'Plantão Ambulatório Cardiologia', organizationId: 'org-1' },
  { id: 'shift-1-9', doctorId: 'doc-3', unitId: 'unit-2', date: '2026-06-28', startTime: '19:00', endTime: '07:00', type: 'onsite', status: 'confirmed', notes: 'Plantão Noturno Pronto Socorro', organizationId: 'org-1' },
  
  // Shifts for July 2026 (Next month)
  { id: 'shift-1-10', doctorId: 'doc-1', unitId: 'unit-2', date: '2026-07-02', startTime: '08:00', endTime: '18:00', type: 'onsite', status: 'confirmed', notes: 'Plantão Coronária', organizationId: 'org-1' },
  { id: 'shift-1-11', doctorId: 'doc-3', unitId: 'unit-1', date: '2026-07-03', startTime: '19:00', endTime: '07:00', type: 'onsite', status: 'confirmed', notes: 'Plantão Noturno Geral', organizationId: 'org-1' },
  { id: 'shift-1-12', doctorId: 'doc-2', unitId: 'unit-1', date: '2026-07-05', startTime: '08:00', endTime: '20:00', type: 'onsite', status: 'pending', notes: 'Pediatria - Fim de semana', organizationId: 'org-1' },
  { id: 'shift-1-13', doctorId: 'doc-1', unitId: 'unit-1', date: '2026-07-08', startTime: '14:00', endTime: '20:00', type: 'telemedicine', status: 'confirmed', organizationId: 'org-1' },
  { id: 'shift-1-14', doctorId: 'doc-3', unitId: 'unit-2', date: '2026-07-10', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'confirmed', organizationId: 'org-1' },

  // ORG 2 SHIFTS (Clínica Norte Saúde)
  { id: 'shift-2-h1', doctorId: 'doc-4', unitId: 'unit-3', date: '2026-06-16', startTime: '08:00', endTime: '17:00', type: 'onsite', status: 'completed', notes: 'Atendimento histórico Ortopedia', organizationId: 'org-2' },
  { id: 'shift-2-h2', doctorId: 'doc-4', unitId: 'unit-3', date: '2026-06-18', startTime: '08:00', endTime: '17:00', type: 'onsite', status: 'completed', notes: 'Atendimento histórico Ortopedia', organizationId: 'org-2' },
  { id: 'shift-2-1', doctorId: 'doc-4', unitId: 'unit-3', date: '2026-06-21', startTime: '08:00', endTime: '17:00', type: 'onsite', status: 'completed', notes: 'Consulta Ortopedia Especializada', organizationId: 'org-2' },
  { id: 'shift-2-2', doctorId: 'doc-5', unitId: 'unit-4', date: '2026-06-22', startTime: '09:00', endTime: '13:00', type: 'onsite', status: 'cancelled', notes: 'Atendimento Dermatológico suspenso', organizationId: 'org-2' },
  { id: 'shift-2-3', doctorId: 'doc-4', unitId: 'unit-3', date: '2026-06-23', startTime: '08:00', endTime: '17:00', type: 'onsite', status: 'confirmed', notes: 'Atendimentos Ortopedia', organizationId: 'org-2' },
  { id: 'shift-2-4', doctorId: 'doc-4', unitId: 'unit-3', date: '2026-06-25', startTime: '13:00', endTime: '18:00', type: 'telemedicine', status: 'confirmed', notes: 'Retornos pós-operatórios', organizationId: 'org-2' },
  { id: 'shift-2-5', doctorId: 'doc-4', unitId: 'unit-3', date: '2026-06-28', startTime: '08:00', endTime: '14:00', type: 'onsite', status: 'pending', organizationId: 'org-2' },
  { id: 'shift-2-6', doctorId: 'doc-4', unitId: 'unit-3', date: '2026-07-01', startTime: '08:00', endTime: '17:00', type: 'onsite', status: 'confirmed', organizationId: 'org-2' },
  { id: 'shift-2-7', doctorId: 'doc-5', unitId: 'unit-4', date: '2026-07-03', startTime: '09:00', endTime: '16:00', type: 'onsite', status: 'confirmed', organizationId: 'org-2' },

  // ORG 3 SHIFTS (Hospital São Lucas)
  { id: 'shift-3-h1', doctorId: 'doc-7', unitId: 'unit-5', date: '2026-06-15', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'completed', notes: 'Cirurgias agendadas Bloco B', organizationId: 'org-3' },
  { id: 'shift-3-h2', doctorId: 'doc-6', unitId: 'unit-5', date: '2026-06-17', startTime: '08:00', endTime: '20:00', type: 'onsite', status: 'completed', notes: 'Plantão Neurologia Geral', organizationId: 'org-3' },
  { id: 'shift-3-h3', doctorId: 'doc-7', unitId: 'unit-6', date: '2026-06-19', startTime: '19:00', endTime: '07:00', type: 'onsite', status: 'completed', notes: 'Plantão Noturno Geral UPA', organizationId: 'org-3' },
  { id: 'shift-3-1', doctorId: 'doc-7', unitId: 'unit-5', date: '2026-06-21', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'completed', notes: 'Anestesia Centro Cirúrgico Bloco A', organizationId: 'org-3' },
  { id: 'shift-3-2', doctorId: 'doc-6', unitId: 'unit-5', date: '2026-06-21', startTime: '08:00', endTime: '20:00', type: 'oncall', status: 'confirmed', notes: 'Sobreaviso Neurologia AVC', organizationId: 'org-3' },
  { id: 'shift-3-3', doctorId: 'doc-7', unitId: 'unit-6', date: '2026-06-22', startTime: '19:00', endTime: '07:00', type: 'onsite', status: 'confirmed', notes: 'Plantão Noturno Geral', organizationId: 'org-3' },
  { id: 'shift-3-4', doctorId: 'doc-6', unitId: 'unit-5', date: '2026-06-23', startTime: '08:00', endTime: '18:00', type: 'onsite', status: 'confirmed', notes: 'Ambulatório de Espasticidade', organizationId: 'org-3' },
  { id: 'shift-3-5', doctorId: 'doc-8', unitId: 'unit-6', date: '2026-06-24', startTime: '08:00', endTime: '20:00', type: 'onsite', status: 'pending', notes: 'Plantão Cardiologia UPA', organizationId: 'org-3' },
  { id: 'shift-3-6', doctorId: 'doc-7', unitId: 'unit-5', date: '2026-06-26', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'confirmed', organizationId: 'org-3' },
  { id: 'shift-3-7', doctorId: 'doc-6', unitId: 'unit-5', date: '2026-06-27', startTime: '12:00', endTime: '24:00', type: 'onsite', status: 'confirmed', organizationId: 'org-3' },
  { id: 'shift-3-8', doctorId: 'doc-8', unitId: 'unit-6', date: '2026-06-28', startTime: '08:00', endTime: '20:00', type: 'onsite', status: 'pending', organizationId: 'org-3' },
  { id: 'shift-3-9', doctorId: 'doc-7', unitId: 'unit-5', date: '2026-07-02', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'confirmed', organizationId: 'org-3' },
  { id: 'shift-3-10', doctorId: 'doc-6', unitId: 'unit-5', date: '2026-07-04', startTime: '08:00', endTime: '20:00', type: 'oncall', status: 'confirmed', organizationId: 'org-3' }
];

export const mockUsers: UserAccount[] = [
  // Admin SaaS Profiles
  {
    id: 'user-gabriel',
    name: 'Gabriel Moraes',
    email: 'gabriel.moraes@nvmed.com.br',
    phone: '(11) 99999-0001',
    type: 'saas_admin',
    organizationId: null,
    role: 'CEO',
    status: 'active',
    createdAt: '2026-01-10',
    lastActive: '2026-06-22',
    avatar: ''
  },
  {
    id: 'user-camila',
    name: 'Camila Torres',
    email: 'camila.torres@nvmed.com.br',
    phone: '(11) 99999-0002',
    type: 'saas_admin',
    organizationId: null,
    role: 'Gerente',
    status: 'active',
    createdAt: '2026-01-12',
    lastActive: '2026-06-22',
    avatar: ''
  },
  {
    id: 'user-rafael',
    name: 'Rafael Lima',
    email: 'rafael.lima@nvmed.com.br',
    phone: '(11) 99999-0003',
    type: 'saas_admin',
    organizationId: null,
    role: 'Coordenador',
    status: 'pending',
    createdAt: '2026-01-15',
    avatar: ''
  },
  {
    id: 'user-beatriz',
    name: 'Beatriz Nunes',
    email: 'beatriz.nunes@nvmed.com.br',
    phone: '(11) 99999-0004',
    type: 'saas_admin',
    organizationId: null,
    role: 'Administrativo',
    status: 'active',
    createdAt: '2026-02-01',
    lastActive: '2026-06-22',
    avatar: ''
  },
  {
    id: 'user-marcelo',
    name: 'Marcelo Prado',
    email: 'marcelo.prado@nvmed.com.br',
    phone: '(11) 99999-0005',
    type: 'saas_admin',
    organizationId: null,
    role: 'Financeiro',
    status: 'inactive',
    createdAt: '2026-02-10',
    lastActive: '2026-06-18',
    avatar: ''
  },
  {
    id: 'user-helena',
    name: 'Helena Duarte',
    email: 'helena.duarte@nvmed.com.br',
    phone: '(11) 99999-0006',
    type: 'saas_admin',
    organizationId: null,
    role: 'Jurídico',
    status: 'active',
    createdAt: '2026-02-15',
    lastActive: '2026-06-19',
    avatar: ''
  },

  // Tenant/Company Profiles (Linked to org-1 by default for demo)
  {
    id: 'user-ana',
    name: 'Ana Souza',
    email: 'ana.souza@nvmed.com.br',
    phone: '(11) 98888-0011',
    type: 'tenant_user',
    organizationId: 'org-1',
    role: 'Diretor',
    status: 'active',
    createdAt: '2026-01-20',
    lastActive: '2026-06-22',
    avatar: ''
  },
  {
    id: 'user-carla',
    name: 'Carla Rocha',
    email: 'carla.rocha@nvmed.com.br',
    phone: '(11) 98888-0012',
    type: 'tenant_user',
    organizationId: 'org-1',
    role: 'Gerente',
    status: 'active',
    createdAt: '2026-01-22',
    lastActive: '2026-06-22',
    avatar: ''
  },
  {
    id: 'user-renata',
    name: 'Renata Lima',
    email: 'renata.lima@nvmed.com.br',
    phone: '(11) 98888-0013',
    type: 'tenant_user',
    organizationId: 'org-1',
    role: 'Coordenador de Escalas',
    status: 'pending',
    createdAt: '2026-01-25',
    avatar: ''
  },
  {
    id: 'user-paulo',
    name: 'Paulo Mendes',
    email: 'paulo.mendes@nvmed.com.br',
    phone: '(11) 98888-0014',
    type: 'tenant_user',
    organizationId: 'org-1',
    role: 'Escalista',
    status: 'inactive',
    createdAt: '2026-02-05',
    lastActive: '2026-06-22',
    avatar: ''
  },
  {
    id: 'user-bruno',
    name: 'Bruno Almeida',
    email: 'bruno.almeida@nvmed.com.br',
    phone: '(11) 98888-0015',
    type: 'tenant_user',
    organizationId: 'org-1',
    role: 'Financeiro',
    status: 'active',
    createdAt: '2026-02-12',
    lastActive: '2026-06-20',
    avatar: ''
  },
  {
    id: 'user-juliana',
    name: 'Juliana Castro',
    email: 'juliana.castro@nvmed.com.br',
    phone: '(11) 98888-0016',
    type: 'tenant_user',
    organizationId: 'org-1',
    role: 'Jurídico',
    status: 'active',
    createdAt: '2026-02-20',
    lastActive: '2026-06-21',
    avatar: ''
  },

  // Other tenants for list checking
  {
    id: 'user-diego',
    name: 'Diego Santos',
    email: 'diego.santos@nortesaude.com.br',
    phone: '(31) 97777-1111',
    type: 'tenant_user',
    organizationId: 'org-2',
    role: 'Escalista',
    status: 'active',
    createdAt: '2026-03-01',
    lastActive: '2026-06-18',
    avatar: ''
  },
  {
    id: 'user-patricia',
    name: 'Patrícia Neves',
    email: 'patricia.neves@nortesaude.com.br',
    phone: '(31) 97777-2222',
    type: 'tenant_user',
    organizationId: 'org-2',
    role: 'Diretor',
    status: 'active',
    createdAt: '2026-03-05',
    lastActive: '2026-06-20',
    avatar: ''
  },
  {
    id: 'user-lucas',
    name: 'Lucas Oliveira',
    email: 'lucas.oliveira@hospitalsaolucas.com.br',
    phone: '(41) 96666-3333',
    type: 'tenant_user',
    organizationId: 'org-3',
    role: 'Gerente',
    status: 'active',
    createdAt: '2026-03-10',
    lastActive: '2026-06-22',
    avatar: ''
  }
];

