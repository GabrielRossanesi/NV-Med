import type { Sector, Shift } from '../types/index.ts';

export function selectShiftSector(shift: Shift, sector?: Sector): Shift {
  if (sector && (sector.organizationId !== shift.organizationId || sector.unitId !== shift.unitId || sector.status !== 'active')) {
    throw new Error('Selecione um setor ativo da mesma empresa e unidade.');
  }
  return { ...shift, sectorId: sector?.id, sector: sector?.name, specialty: sector?.primarySpecialty || '' };
}

export function reconcileShiftDoctor(shift: Shift, eligibleIds: string[]): Shift {
  return !shift.doctorId || eligibleIds.includes(shift.doctorId) ? shift : { ...shift, doctorId: undefined, status: 'open' };
}

export function scopedSpecialties(company: string[], unit: string[], sector?: string[]) {
  const lists = [company, unit, sector || []].filter(items => items.length);
  const first = lists[0] || [];
  return [...new Set(first)].filter(item => lists.every(items => items.includes(item))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
