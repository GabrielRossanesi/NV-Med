export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

export function getPasswordChecks(password: string) {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9\s]/.test(password),
    noWhitespace: !/\s/.test(password),
  };
}

export function isStrongPassword(password: string) {
  return Object.values(getPasswordChecks(password)).every(Boolean);
}
