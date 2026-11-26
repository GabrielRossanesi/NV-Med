export function formatStorageBytes(bytes: number) {
  const [divisor, unit] = bytes >= 1e9 ? [1e9, 'GB'] : bytes >= 1e6 ? [1e6, 'MB'] : bytes >= 1e3 ? [1e3, 'KB'] : [1, 'B'];
  return `${(bytes / Number(divisor)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`;
}
