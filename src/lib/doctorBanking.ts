export const pixKeyTypes = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', phone: 'Telefone', evp: 'Chave aleatória (EVP)' } as const;
export type PixKeyType = keyof typeof pixKeyTypes;
export type DoctorBanking = { pix_key: string; pix_key_type: PixKeyType | ''; bank: string; bank_code: string; bank_ispb: string; agency: string; account_number: string };
export const emptyBanking: DoctorBanking = { pix_key: '', pix_key_type: '', bank: '', bank_code: '', bank_ispb: '', agency: '', account_number: '' };

export function validTaxId(value: string, type: 'cpf' | 'cnpj') {
  if (type === 'cpf') {
    if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
    for (let size = 9; size <= 10; size++) {
      const sum = [...value.slice(0, size)].reduce((total, digit, index) => total + Number(digit) * (size + 1 - index), 0);
      if (((sum * 10) % 11) % 10 !== Number(value[size])) return false;
    }
    return true;
  }
  // The ASCII - 48 algorithm also preserves validation of numeric CNPJs.
  if (!/^[A-Z0-9]{12}\d{2}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let size = 12; size <= 13; size++) {
    const sum = [...value.slice(0, size)].reduce((total, digit, index) => total + (digit.charCodeAt(0) - 48) * ((size - 1 - index) % 8 + 2), 0);
    const remainder = sum % 11;
    if ((remainder < 2 ? 0 : 11 - remainder) !== Number(value[size])) return false;
  }
  return true;
}

export function normalizePixKey(type: string, input: string): string {
  let value = input.trim();
  if (type === 'cpf' || type === 'cnpj') {
    if (!/^[\dA-Za-z.\-/\s]+$/.test(value)) throw new Error('Confira a chave PIX e seus dígitos verificadores.');
    value = value.replace(/[.\-/\s]/g, '').toUpperCase();
    if (!validTaxId(value, type)) throw new Error(`Informe um ${type.toUpperCase()} válido para a chave PIX.`);
  } else if (type === 'email') {
    value = value.toLowerCase();
    if (value.length > 77 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Informe um e-mail válido para a chave PIX (até 77 caracteres).');
  } else if (type === 'phone') {
    if (!/^\+?[\d\s().-]+$/.test(value)) throw new Error('Informe um telefone com DDD ou código internacional.');
    const international = value.startsWith('+');
    value = value.replace(/[^\d+]/g, '');
    if (!international) {
      if (/^\d{10,11}$/.test(value)) value = '+55' + value;
      else if (/^55\d{10,11}$/.test(value)) value = '+' + value;
      else throw new Error('Informe o DDD brasileiro ou use + e o código do país.');
    }
    if (!/^\+[1-9]\d{7,14}$/.test(value) || (value.startsWith('+55') && !/^\+55[1-9]\d{9,10}$/.test(value))) throw new Error('Informe um telefone válido no padrão internacional.');
  } else if (type === 'evp') {
    value = value.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('Informe uma chave aleatória UUID v4 válida.');
  } else throw new Error('Selecione o tipo de chave PIX.');
  return value;
}

export function normalizeBanking(input: DoctorBanking): DoctorBanking {
  const result = { ...input, pix_key: normalizePixKey(input.pix_key_type, input.pix_key) };
  for (const field of ['bank', 'bank_code', 'bank_ispb', 'agency', 'account_number'] as const) result[field] = input[field].trim();
  if (result.bank.length > 200 || /[\u0000-\u001f\u007f]/.test(result.bank)
    || (result.bank_code && !/^\d{3}$/.test(result.bank_code)) || (result.bank_ispb && !/^\d{8}$/.test(result.bank_ispb))
    || [result.agency, result.account_number].some(value => value && !/^[0-9A-Za-z][0-9A-Za-z. /-]{0,29}$/.test(value))) throw new Error('Confira o banco, a agência e a conta (até 30 caracteres).');
  return result;
}

export function bankingFromForm(form: FormData): DoctorBanking {
  return normalizeBanking(Object.fromEntries(Object.keys(emptyBanking).map(key => [key, String(form.get(key) || '')])) as DoctorBanking);
}
