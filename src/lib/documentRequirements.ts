import type { DocumentRequirement, Unit } from '../types/index.ts';

export const crmStates = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export const starterDocumentRequirements: DocumentRequirement[] = [
  { type: 'crm', name: 'Carteira do CRM (frente e verso)', required: true },
  { type: 'rg_cnh', name: 'RG ou CNH (frente e verso)', required: true },
  { type: 'diploma_medicina', name: 'Diploma de Medicina (frente e verso)', required: true },
  { type: 'certidao_crm_financeira', name: 'Certidão de quitação do CRM', required: true, expiryRequired: true, annualRenewal: true },
  { type: 'certidao_crm_etica', name: 'Certidão ético-profissional do CRM', required: true, expiryRequired: true, annualRenewal: true },
  { type: 'comprovante_residencia', name: 'Comprovante de endereço atualizado', required: true },
  { type: 'curriculo', name: 'Currículo', required: true },
  { type: 'diploma_residencia', name: 'Comprovante de especialidade', required: false },
  { type: 'acls', name: 'ACLS', required: false },
  { type: 'atls', name: 'ATLS', required: false },
  { type: 'pals', name: 'PALS', required: false },
  { type: 'certidao_civil', name: 'Certidão de nascimento ou casamento', required: false },
  { type: 'vacinas', name: 'Carteira de vacinação', required: false },
  { type: 'vacina_covid', name: 'Comprovante de vacinação contra Covid-19', required: false },
];

export function documentTypeFromName(name: string, requirements: DocumentRequirement[]) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'documento';
  const base = `custom_${normalized}`;
  let type = base;
  let suffix = 2;
  while (requirements.some(requirement => requirement.type === type)) type = `${base}_${suffix++}`;
  return type;
}

export function validateDocumentRequirement(requirement: DocumentRequirement, requirements: DocumentRequirement[], units: Pick<Unit, 'id'>[], scope: 'all' | 'selected') {
  if (requirement.name.trim().length < 3 || requirement.name.trim().length > 120) return 'Informe um nome entre 3 e 120 caracteres.';
  if (requirements.some(item => item.type !== requirement.type && item.name.localeCompare(requirement.name.trim(), 'pt-BR', { sensitivity: 'base' }) === 0)) return 'Já existe um documento com esse nome. Edite sua abrangência na lista.';
  if (scope === 'selected' && !requirement.unitIds?.length) return 'Selecione pelo menos uma unidade para esta exigência.';
  if (requirement.unitIds?.some(id => !units.some(unit => unit.id === id))) return 'Selecione apenas unidades desta empresa.';
  if (requirement.states?.some(state => !crmStates.includes(state))) return 'Selecione UFs válidas para o registro no CRM.';
  return '';
}
