export const officialAppOrigin = 'https://med.nvcore.com.br';

export function buildAppOrigin(mode: string, configuredOrigin: string | undefined) {
  if (mode !== 'production') return '';
  if (configuredOrigin !== officialAppOrigin) {
    throw new Error('Configure a origem oficial do NV Med no ambiente Production.');
  }
  return officialAppOrigin;
}

type AuthPath = '/login' | '/portal' | '/auth/confirm' | '/definir-senha';

export function authFlowUrl(path: AuthPath, currentOrigin: string, organization?: string | null) {
  const url = new URL(path, process.env.NVMED_BUILT_APP_ORIGIN || currentOrigin);
  if (organization && /^[A-Za-z0-9_-]{1,100}$/.test(organization)) {
    url.searchParams.set('empresa', organization);
  }
  return url;
}
