-- ==============================================================================
-- NV MED - INITIAL SEED DATA FOR SUPABASE (São Paulo / sa-east-1)
-- ==============================================================================

-- 1. ORGANIZATIONS
INSERT INTO public.organizations (id, name, razao_social, cnpj, phone, email, address, city, state, plan, status, enabled_modules, settings, last_active, created_at)
VALUES
(
  'org-1',
  'NV Med Operadora Demo',
  'NV Med Gestão e Serviços Médicos Ltda',
  '12.345.678/0001-90',
  '(11) 98888-7777',
  'contato@nvmed.com.br',
  'Av. Paulista, 1000, Bela Vista, São Paulo - SP',
  'São Paulo',
  'SP',
  'platinum',
  'active',
  ARRAY['Dashboard', 'Médicos', 'Unidades', 'Documentos', 'Escala', 'Configurações', 'Relatórios'],
  '{"specialties": ["Clínico Geral", "Cardiologia", "Pediatria", "Ginecologia", "Ortopedia", "Dermatologia", "Anestesiologia"], "requiredDocuments": [{"type": "rg_cnh", "name": "RG/CNH", "required": true}, {"type": "diploma_medicina", "name": "Diploma de Medicina", "required": true}, {"type": "diploma_residencia", "name": "Diploma de Residência ou Pós-graduação", "required": true}, {"type": "comprovante_residencia", "name": "Comprovante de endereço residencial", "required": true}, {"type": "certidao_crm_etica", "name": "Certidão Ética CRM", "required": true}, {"type": "certidao_crm_financeira", "name": "Certidão Financeira CRM", "required": true}]}'::jsonb,
  '2026-06-22',
  '2025-01-10'
),
(
  'org-2',
  'Clínica Norte Saúde',
  'Norte Saúde Assistência Médica S/A',
  '98.765.432/0001-10',
  '(85) 3245-8800',
  'gerencia@nortesaude.com.br',
  'Av. Santos Dumont, 1000, Aldeota, Fortaleza - CE',
  'Fortaleza',
  'CE',
  'gold',
  'active',
  ARRAY['Dashboard', 'Médicos', 'Unidades', 'Documentos', 'Escala'],
  '{"specialties": ["Clínico Geral", "Ortopedia", "Dermatologia", "Oftalmologia", "Pediatria"], "requiredDocuments": [{"type": "rg_cnh", "name": "RG/CNH", "required": true}, {"type": "diploma_medicina", "name": "Diploma de Medicina", "required": true}, {"type": "comprovante_residencia", "name": "Comprovante de endereço residencial", "required": true}, {"type": "certidao_crm_etica", "name": "Certidão Ética CRM", "required": true}]}'::jsonb,
  '2026-06-21',
  '2025-03-01'
),
(
  'org-3',
  'Hospital São Lucas',
  'Sociedade Beneficente São Lucas',
  '45.678.901/0001-22',
  '(11) 3012-9900',
  'coordenacao@hospitalsaolucas.com.br',
  'Rua Vergueiro, 3000, Vila Mariana, São Paulo - SP',
  'São Paulo',
  'SP',
  'silver',
  'setup',
  ARRAY['Dashboard', 'Médicos', 'Unidades', 'Escala'],
  '{"specialties": ["Clínico Geral", "Cardiologia", "Pediatria", "Neurologia", "Anestesiologia", "Traumatologia", "Ginecologia"], "requiredDocuments": [{"type": "rg_cnh", "name": "RG/CNH", "required": true}, {"type": "diploma_medicina", "name": "Diploma de Medicina", "required": true}, {"type": "diploma_residencia", "name": "Diploma de Residência ou Pós-graduação", "required": true}, {"type": "comprovante_residencia", "name": "Comprovante de endereço residencial", "required": true}, {"type": "certidao_crm_etica", "name": "Certidão Ética CRM", "required": true}, {"type": "certidao_crm_financeira", "name": "Certidão Financeira CRM", "required": true}]}'::jsonb,
  '2026-06-20',
  '2026-02-15'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  razao_social = EXCLUDED.razao_social,
  plan = EXCLUDED.plan,
  status = EXCLUDED.status,
  enabled_modules = EXCLUDED.enabled_modules,
  settings = EXCLUDED.settings;

-- 2. USER ACCOUNTS (Admin SaaS & Clientes)
INSERT INTO public.user_accounts (id, name, email, phone, type, organization_id, role, status, last_active, created_at)
VALUES
('user-gabriel', 'Gabriel Moraes', 'gabriel.moraes@nvmed.com.br', '(11) 99999-0001', 'saas_admin', NULL, 'CEO', 'active', '2026-06-22', '2026-01-10'),
('user-camila', 'Camila Torres', 'camila.torres@nvmed.com.br', '(11) 99999-0002', 'saas_admin', NULL, 'Gerente', 'active', '2026-06-22', '2026-01-12'),
('user-rafael', 'Rafael Lima', 'rafael.lima@nvmed.com.br', '(11) 99999-0003', 'saas_admin', NULL, 'Coordenador', 'pending', NULL, '2026-01-15'),
('user-beatriz', 'Beatriz Nunes', 'beatriz.nunes@nvmed.com.br', '(11) 99999-0004', 'saas_admin', NULL, 'Administrativo', 'active', '2026-06-22', '2026-02-01'),
('user-marcelo', 'Marcelo Prado', 'marcelo.prado@nvmed.com.br', '(11) 99999-0005', 'saas_admin', NULL, 'Financeiro', 'inactive', '2026-06-18', '2026-02-10'),
('user-helena', 'Helena Duarte', 'helena.duarte@nvmed.com.br', '(11) 99999-0006', 'saas_admin', NULL, 'Jurídico', 'active', '2026-06-19', '2026-02-15'),
-- Tenant Users (org-1)
('user-ana', 'Ana Souza', 'ana.souza@nvmed.com.br', '(11) 98888-0011', 'tenant_user', 'org-1', 'Diretor', 'active', '2026-06-22', '2026-01-20'),
('user-carla', 'Carla Rocha', 'carla.rocha@nvmed.com.br', '(11) 98888-0012', 'tenant_user', 'org-1', 'Gerente', 'active', '2026-06-22', '2026-01-22'),
('user-renata', 'Renata Lima', 'renata.lima@nvmed.com.br', '(11) 98888-0013', 'tenant_user', 'org-1', 'Coordenador de Escalas', 'pending', NULL, '2026-01-25'),
('user-paulo', 'Paulo Mendes', 'paulo.mendes@nvmed.com.br', '(11) 98888-0014', 'tenant_user', 'org-1', 'Escalista', 'inactive', '2026-06-22', '2026-02-05'),
('user-bruno', 'Bruno Almeida', 'bruno.almeida@nvmed.com.br', '(11) 98888-0015', 'tenant_user', 'org-1', 'Financeiro', 'active', '2026-06-20', '2026-02-12'),
('user-juliana', 'Juliana Castro', 'juliana.castro@nvmed.com.br', '(11) 98888-0016', 'tenant_user', 'org-1', 'Jurídico', 'active', '2026-06-21', '2026-02-20'),
-- Other tenants
('user-diego', 'Diego Santos', 'diego.santos@nortesaude.com.br', '(31) 97777-1111', 'tenant_user', 'org-2', 'Escalista', 'active', '2026-06-18', '2026-03-01'),
('user-patricia', 'Patrícia Neves', 'patricia.neves@nortesaude.com.br', '(31) 97777-2222', 'tenant_user', 'org-2', 'Diretor', 'active', '2026-06-20', '2026-03-05'),
('user-lucas', 'Lucas Oliveira', 'lucas.oliveira@hospitalsaolucas.com.br', '(41) 96666-3333', 'tenant_user', 'org-3', 'Gerente', 'active', '2026-06-22', '2026-03-10')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  status = EXCLUDED.status;

-- 3. UNITS (Unidades de Atendimento)
INSERT INTO public.units (id, organization_id, name, cnpj, address, city, state, type, manager, phone, status, specialties, created_at)
VALUES
('unit-1', 'org-1', 'Pronto Atendimento NV Med Paulista', '12.345.678/0001-90', 'Av. Paulista, 1000', 'São Paulo', 'SP', 'er', 'Marcos Ribeiro', '(11) 98888-7777', 'active', ARRAY['Clínico Geral', 'Pediatria', 'Ortopedia'], NOW()),
('unit-2', 'org-1', 'Hospital NV Med Pinheiros', '12.345.678/0002-88', 'Rua dos Pinheiros, 500', 'São Paulo', 'SP', 'hospital', 'Luisa Albuquerque', '(11) 97777-6666', 'active', ARRAY['Cardiologia', 'Clínico Geral', 'Ginecologia', 'Anestesiologia', 'Dermatologia'], NOW()),
('unit-3', 'org-2', 'Clínica Norte Saúde Lourdes', '98.765.432/0001-10', 'Av. Norte, 1500', 'Belo Horizonte', 'MG', 'clinic', 'Claudio Neves', '(31) 96666-5555', 'active', ARRAY['Ortopedia', 'Clínico Geral', 'Pediatria'], NOW()),
('unit-4', 'org-2', 'Pronto Atendimento Norte Pampulha', '98.765.432/0003-20', 'Av. Antonio Carlos, 6000', 'Belo Horizonte', 'MG', 'er', 'Patricia Lima', '(31) 95555-4444', 'active', ARRAY['Clínico Geral', 'Dermatologia', 'Oftalmologia'], NOW()),
('unit-5', 'org-3', 'Hospital São Lucas Central', '45.678.901/0001-22', 'Rua São Lucas, 12', 'Curitiba', 'PR', 'hospital', 'Dr. Geraldo Alckmin', '(41) 94444-3333', 'active', ARRAY['Neurologia', 'Anestesiologia', 'Cardiologia', 'Clínico Geral', 'Ginecologia'], NOW()),
('unit-6', 'org-3', 'UPA São Lucas Portão', '45.678.901/0002-11', 'Av. República Argentina, 2500', 'Curitiba', 'PR', 'upa', 'Sandra de Anchieta', '(41) 93333-2222', 'active', ARRAY['Clínico Geral', 'Pediatria', 'Traumatologia'], NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  specialties = EXCLUDED.specialties;

-- 4. DOCTORS (Corpo Clínico)
INSERT INTO public.doctors (id, organization_id, name, crm, crm_uf, cpf, phone, email, specialty, address, status, linked_units, created_at)
VALUES
('doc-1', 'org-1', 'Dr. Carlos Eduardo Silva', '123456', 'SP', '123.456.789-00', '(11) 99123-4567', 'carlos.silva@nvmed.com.br', 'Cardiologia', 'Av. Rebouças, 1200, Ap 52 - Pinheiros, São Paulo - SP', 'active', ARRAY['unit-1', 'unit-2'], NOW()),
('doc-2', 'org-1', 'Dra. Mariana Costa Martins', '789012', 'SP', '987.654.321-11', '(11) 99876-5432', 'mariana.costa@nvmed.com.br', 'Pediatria', 'Rua Pamplona, 800 - Jardim Paulista, São Paulo - SP', 'pending', ARRAY['unit-1'], NOW()),
('doc-3', 'org-1', 'Dr. Roberto Alencar de Melo', '345678', 'SP', '456.789.123-22', '(11) 99456-7890', 'roberto.alencar@nvmed.com.br', 'Clínico Geral', 'Rua Bela Cintra, 2300 - Consolação, São Paulo - SP', 'active', ARRAY['unit-2'], NOW()),
('doc-4', 'org-2', 'Dra. Juliana Fernandes Ribeiro', '901234', 'MG', '234.567.890-33', '(31) 98765-1234', 'juliana.fernandes@nortesaude.com.br', 'Ortopedia', 'Rua da Bahia, 1400 - Centro, Belo Horizonte - MG', 'active', ARRAY['unit-3'], NOW()),
('doc-5', 'org-2', 'Dr. Felipe Santos Oliveira', '567890', 'MG', '345.678.901-44', '(31) 98877-6655', 'felipe.santos@nortesaude.com.br', 'Dermatologia', 'Rua Paraíba, 900 - Savassi, Belo Horizonte - MG', 'inactive', ARRAY['unit-4'], NOW()),
('doc-6', 'org-3', 'Dra. Beatrice Souza de Paula', '234567', 'PR', '567.890.123-55', '(41) 99111-2222', 'beatrice.souza@saolucas.com.br', 'Neurologia', 'Rua XV de Novembro, 1200 - Centro, Curitiba - PR', 'active', ARRAY['unit-5'], NOW()),
('doc-7', 'org-3', 'Dr. Arthur Pendragon Silva', '876543', 'PR', '678.901.234-66', '(41) 99222-3333', 'arthur.p@saolucas.com.br', 'Anestesiologia', 'Av. Sete de Setembro, 3400 - Batel, Curitiba - PR', 'active', ARRAY['unit-5', 'unit-6'], NOW()),
('doc-8', 'org-3', 'Dra. Helena Troia Medeiros', '432109', 'PR', '789.012.345-77', '(41) 99333-4444', 'helena.troia@saolucas.com.br', 'Cardiologia', 'Rua Padre Anchieta, 1500 - Bigorrilho, Curitiba - PR', 'pending', ARRAY['unit-6'], NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  specialty = EXCLUDED.specialty,
  linked_units = EXCLUDED.linked_units;

-- 5. MEDICAL DOCUMENTS
INSERT INTO public.medical_documents (id, organization_id, doctor_id, name, type, status, upload_date, expiry_date, file_name, created_at)
VALUES
('doc-1-1', 'org-1', 'doc-1', 'RG/CNH', 'rg_cnh', 'approved', '2026-01-10', NULL, 'rg_carlos_silva.pdf', NOW()),
('doc-1-2', 'org-1', 'doc-1', 'Diploma de Medicina', 'diploma_medicina', 'approved', '2026-01-10', NULL, 'diploma_medicina_carlos.pdf', NOW()),
('doc-1-3', 'org-1', 'doc-1', 'Diploma de Residência ou Pós-graduação', 'diploma_residencia', 'approved', '2026-01-12', NULL, 'residencia_cardio_carlos.pdf', NOW()),
('doc-1-4', 'org-1', 'doc-1', 'Comprovante de endereço residencial', 'comprovante_residencia', 'approved', '2026-05-15', '2026-11-15', 'comprovante_res_carlos.pdf', NOW()),
('doc-1-5', 'org-1', 'doc-1', 'Certidão Ética CRM', 'certidao_crm_etica', 'approved', '2026-02-20', '2027-02-20', 'certidao_crm_etica_carlos.pdf', NOW()),
('doc-1-6', 'org-1', 'doc-1', 'Certidão Financeira CRM', 'certidao_crm_financeira', 'approved', '2026-02-20', '2027-02-20', 'certidao_crm_financeira_carlos.pdf', NOW()),
('doc-2-1', 'org-1', 'doc-2', 'RG/CNH', 'rg_cnh', 'approved', '2026-06-01', NULL, 'rg_mariana_costa.pdf', NOW()),
('doc-2-2', 'org-1', 'doc-2', 'Diploma de Medicina', 'diploma_medicina', 'analyzing', '2026-06-18', NULL, 'diploma_mariana_crm.pdf', NOW()),
('doc-2-3', 'org-1', 'doc-2', 'Diploma de Residência ou Pós-graduação', 'diploma_residencia', 'not_sent', NULL, NULL, NULL, NOW()),
('doc-2-4', 'org-1', 'doc-2', 'Comprovante de endereço residencial', 'comprovante_residencia', 'expired', '2025-12-01', '2026-03-01', 'comprovante_antigo_mariana.pdf', NOW()),
('doc-2-5', 'org-1', 'doc-2', 'Certidão Ética CRM', 'certidao_crm_etica', 'rejected', '2026-05-10', NULL, 'certidao_errada.pdf', NOW()),
('doc-2-6', 'org-1', 'doc-2', 'Certidão Financeira CRM', 'certidao_crm_financeira', 'not_sent', NULL, NULL, NULL, NOW()),
('doc-3-1', 'org-1', 'doc-3', 'RG/CNH', 'rg_cnh', 'approved', '2026-02-15', NULL, 'cnh_roberto_alencar.pdf', NOW()),
('doc-3-2', 'org-1', 'doc-3', 'Diploma de Medicina', 'diploma_medicina', 'approved', '2026-02-15', NULL, 'diploma_roberto.pdf', NOW()),
('doc-3-3', 'org-1', 'doc-3', 'Diploma de Residência ou Pós-graduação', 'diploma_residencia', 'approved', '2026-02-16', NULL, 'pos_roberto.pdf', NOW()),
('doc-3-4', 'org-1', 'doc-3', 'Comprovante de endereço residencial', 'comprovante_residencia', 'approved', '2026-04-10', '2026-10-10', 'comprovante_roberto.pdf', NOW()),
('doc-3-5', 'org-1', 'doc-3', 'Certidão Ética CRM', 'certidao_crm_etica', 'expired', '2025-05-15', '2026-05-15', 'crm_etica_roberto.pdf', NOW()),
('doc-3-6', 'org-1', 'doc-3', 'Certidão Financeira CRM', 'certidao_crm_financeira', 'approved', '2026-04-10', '2027-04-10', 'crm_fin_roberto.pdf', NOW())
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  file_name = EXCLUDED.file_name,
  upload_date = EXCLUDED.upload_date;

-- 6. SHIFTS (Plantões)
INSERT INTO public.shifts (id, organization_id, doctor_id, unit_id, date, start_time, end_time, type, status, notes, created_at)
VALUES
('shift-1-h1', 'org-1', 'doc-1', 'unit-1', '2026-06-15', '08:00', '20:00', 'onsite', 'completed', 'Plantão histórico Pronto Atendimento', NOW()),
('shift-1-h2', 'org-1', 'doc-3', 'unit-2', '2026-06-16', '19:00', '07:00', 'onsite', 'completed', 'Plantão histórico Noturno UTI', NOW()),
('shift-1-h3', 'org-1', 'doc-1', 'unit-2', '2026-06-18', '08:00', '18:00', 'onsite', 'completed', 'Plantão histórico UTI Coronária', NOW()),
('shift-1-h4', 'org-1', 'doc-3', 'unit-1', '2026-06-20', '07:00', '19:00', 'onsite', 'completed', 'Plantão histórico Clínico Geral', NOW()),
('shift-1-1', 'org-1', 'doc-1', 'unit-2', '2026-06-21', '08:00', '18:00', 'onsite', 'completed', 'Plantão diurno UTI Geral', NOW()),
('shift-1-2', 'org-1', 'doc-3', 'unit-1', '2026-06-21', '19:00', '07:00', 'onsite', 'confirmed', 'Plantão noturno Pronto Atendimento', NOW()),
('shift-1-3', 'org-1', 'doc-1', 'unit-1', '2026-06-22', '08:00', '14:00', 'telemedicine', 'pending', 'Telemedicina Cardiologia', NOW()),
('shift-1-4', 'org-1', 'doc-2', 'unit-1', '2026-06-22', '13:00', '19:00', 'onsite', 'confirmed', 'Plantão Pediatria Ambulatório', NOW()),
('shift-1-5', 'org-1', 'doc-3', 'unit-2', '2026-06-24', '07:00', '19:00', 'onsite', 'confirmed', 'Plantão Enfermaria', NOW()),
('shift-1-6', 'org-1', 'doc-1', 'unit-2', '2026-06-25', '08:00', '20:00', 'oncall', 'confirmed', 'Sobreaviso Cardiologia', NOW()),
('shift-1-7', 'org-1', 'doc-2', 'unit-1', '2026-06-26', '08:00', '20:00', 'onsite', 'pending', 'Pediatria Emergência', NOW()),
('shift-1-8', 'org-1', 'doc-1', 'unit-2', '2026-06-27', '07:00', '19:00', 'onsite', 'confirmed', 'Plantão Ambulatório Cardiologia', NOW()),
('shift-1-9', 'org-1', 'doc-3', 'unit-2', '2026-06-28', '19:00', '07:00', 'onsite', 'confirmed', 'Plantão Noturno Pronto Socorro', NOW()),
('shift-1-10', 'org-1', 'doc-1', 'unit-2', '2026-07-02', '08:00', '18:00', 'onsite', 'confirmed', 'Plantão Coronária', NOW()),
('shift-1-11', 'org-1', 'doc-3', 'unit-1', '2026-07-03', '19:00', '07:00', 'onsite', 'confirmed', 'Plantão Noturno Geral', NOW()),
('shift-1-12', 'org-1', 'doc-2', 'unit-1', '2026-07-05', '08:00', '20:00', 'onsite', 'pending', 'Pediatria - Fim de semana', NOW()),
('shift-1-13', 'org-1', 'doc-1', 'unit-1', '2026-07-08', '14:00', '20:00', 'telemedicine', 'confirmed', NULL, NOW()),
('shift-1-14', 'org-1', 'doc-3', 'unit-2', '2026-07-10', '07:00', '19:00', 'onsite', 'confirmed', NULL, NOW()),
('shift-2-1', 'org-2', 'doc-4', 'unit-3', '2026-06-21', '08:00', '17:00', 'onsite', 'completed', 'Consulta Ortopedia Especializada', NOW()),
('shift-2-2', 'org-2', 'doc-5', 'unit-4', '2026-06-22', '09:00', '13:00', 'onsite', 'cancelled', 'Atendimento Dermatológico suspenso', NOW()),
('shift-2-3', 'org-2', 'doc-4', 'unit-3', '2026-06-23', '08:00', '17:00', 'onsite', 'confirmed', 'Atendimentos Ortopedia', NOW()),
('shift-3-1', 'org-3', 'doc-7', 'unit-5', '2026-06-21', '07:00', '19:00', 'onsite', 'completed', 'Anestesia Centro Cirúrgico Bloco A', NOW()),
('shift-3-2', 'org-3', 'doc-6', 'unit-5', '2026-06-21', '08:00', '20:00', 'oncall', 'confirmed', 'Sobreaviso Neurologia AVC', NOW())
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  notes = EXCLUDED.notes;
