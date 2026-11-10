export function scopedSpecialties(company: string[], unit: string[], sector?: string[]) {
  const lists = [company, unit, sector || []].filter(items => items.length);
  const first = lists[0] || [];
  return [...new Set(first)].filter(item => lists.every(items => items.includes(item))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
