export const doctorAddressLimit = 500;

export const doctorAddressFieldLimits = {
  street: 150, number: 24, complement: 95, district: 65, city: 65, state: 2, cep: 9,
} as const;

const addressLabels = {
  street: 'Logradouro', number: 'Número', complement: 'Complemento', district: 'Bairro', city: 'Cidade', state: 'UF', cep: 'CEP',
} as const;

type AddressField = keyof typeof addressLabels;
export type DoctorAddress = Record<AddressField, string>;
export type CepAddress = Pick<DoctorAddress, 'street' | 'district' | 'city' | 'state'>;

const addressFields = Object.keys(addressLabels) as AddressField[];
export const emptyDoctorAddress: DoctorAddress = { street: '', number: '', complement: '', district: '', city: '', state: '', cep: '' };

export function normalizeDoctorCep(value: string) {
  const cep = value.trim();
  return /^\d{5}-?\d{3}$/.test(cep) ? cep.replace('-', '') : '';
}

// Keep structured addresses readable in the existing text column and in exports.
export function formatDoctorAddress(address: DoctorAddress) {
  const cep = normalizeDoctorCep(address.cep);
  const values = { ...address, cep: cep ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '' };
  return addressFields.flatMap(field => {
    const value = values[field].trim();
    return value ? [`${addressLabels[field]}: ${value}`] : [];
  }).join('\n');
}

export function parseDoctorAddress(value: string | null | undefined): DoctorAddress | null {
  const text = (value ?? '').replace(/\r\n/g, '\n');
  if (!text) return null;
  const address = { ...emptyDoctorAddress };
  for (const line of text.split('\n')) {
    const field = addressFields.find(key => line.startsWith(`${addressLabels[key]}: `));
    if (!field || address[field]) return null;
    address[field] = line.slice(addressLabels[field].length + 2);
  }
  return formatDoctorAddress(address) === text ? address : null;
}

export function applyCepAddress(current: DoctorAddress, previous: DoctorAddress, result: CepAddress): DoctorAddress {
  const address = { ...current };
  for (const field of ['street', 'district', 'city', 'state'] as const) {
    if (result[field] && current[field] === previous[field]) address[field] = result[field];
  }
  return address;
}
