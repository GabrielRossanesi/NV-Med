const particles = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const whitespace = /[\p{White_Space}\uFEFF]+/gu;
const numbers = /\p{N}+/gu;
const validName = /^\p{L}\p{M}*(?:\p{L}\p{M}*|[ '\u02bc\u2010\u2011\u2019-]\p{L}\p{M}*)*$/u;

export const doctorNameNumberError = 'O nome do médico não pode conter números. Utilize o campo de CRM para informações de registro profissional.';
export const doctorNameInvalidError = 'Informe um nome de médico válido, com 3 a 150 caracteres.';

function cleanSpacing(value: string) {
  return value.replace(whitespace, ' ').trim();
}

export function normalizeDoctorName(value: string, preserveCapitalization = false) {
  const clean = cleanSpacing(value.replace(numbers, '')).normalize('NFC');
  if (preserveCapitalization) return clean;

  return clean.toLowerCase().split(' ').map((word, index) => {
    if (index > 0 && particles.has(word)) return word;
    return word.replace(/(^|['\u02bc\u2010\u2011\u2019-])(\p{L})/gu, (_, boundary: string, letter: string) => {
      const upper = letter === 'ß' ? 'ẞ' : letter.toUpperCase();
      return boundary + ([...upper].length === 1 ? upper : letter);
    });
  }).join(' ').normalize('NFC');
}

export function validateDoctorName(value: string) {
  if (/\p{N}/u.test(value)) throw new Error(doctorNameNumberError);
  const cleaned = normalizeDoctorName(value, true);
  const length = [...cleaned].length;
  if (length < 3 || length > 150 || !validName.test(cleaned)) throw new Error(doctorNameInvalidError);
}

export function doctorNameFromForm(form: FormData, original?: string) {
  const raw = String(form.get('name') ?? '');
  if (raw === original) return raw;
  validateDoctorName(raw);
  return normalizeDoctorName(raw, form.has('nameCapitalizationOverride'));
}

export function doctorNameSearchKey(value: string) {
  return cleanSpacing(value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''));
}

export function matchesDoctorSearch(doctor: { name: string; crm: string; rqe?: string; specialty: string }, query: string) {
  const term = doctorNameSearchKey(query);
  const registration = cleanSpacing(query);
  if (/^[0-9]+$/.test(registration)) return doctor.crm.includes(registration) || (doctor.rqe || '').includes(registration);
  return doctorNameSearchKey(doctor.name).includes(term) || doctorNameSearchKey(doctor.specialty).includes(term);
}
