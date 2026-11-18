import type { Sector, Unit } from '../types/index.ts';
export type SectorSelection = 'all' | string[];
export function scheduleSectors(unitId: string, selection: SectorSelection, units: Unit[], sectors: Sector[]) {
  const unit = units.find(item => item.id === unitId && item.status === 'active');
  if (!unit) return [];
  const ids = selection === 'all' ? null : new Set(selection);
  return sectors.filter(item => item.unitId === unit.id && item.organizationId === unit.organizationId && item.status === 'active' && (!ids || ids.has(item.id)));
}
export const scheduleIdleMs = 60_000;
export function scheduleLeaseValid(unlocked: boolean, lastEdit: number, now: number, saving: boolean) {
  return unlocked && (saving || now - lastEdit < scheduleIdleMs);
}
