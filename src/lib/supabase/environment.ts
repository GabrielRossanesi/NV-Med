import { createHash } from 'node:crypto';

// Fingerprint of the audited production hostname. This is public routing metadata.
const productionFingerprint = '17c073cccfdd1f97623a18d090f5fa1372b88dcef9fec25463d9d7ece6543c99';
const projectHost = /^[a-z0-9]{20}\.supabase\.co$/;
const localHosts = ['localhost', '127.0.0.1'];

function reject(): never {
  throw new Error('Configuração Supabase bloqueada. Confira o escopo e o destino no guia de homologação.');
}

function isProduction(host: string) {
  return createHash('sha256').update(host).digest('hex') === productionFingerprint;
}

export function validateSupabaseEnvironment(env: NodeJS.ProcessEnv, developmentServer = false) {
  const vercel = env.VERCEL === '1';
  const mode = env.NVMED_ENVIRONMENT || 'development';
  if (!['development', 'preview', 'production'].includes(mode)
    || (vercel && mode !== env.VERCEL_ENV)
    || (mode === 'production' && (!vercel || developmentServer))) reject();

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (mode === 'development' && !url && !publicKey && !serviceKey) return { mode, origin: '' };
  if (!url || !publicKey || (mode !== 'development' && !serviceKey)) reject();

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return reject();
  }
  if (url !== target.origin && url !== target.origin + '/') reject();
  const host = target.hostname;
  const production = isProduction(host);
  const loopback = localHosts.includes(host);
  const expected = env.NVMED_SUPABASE_HOMOLOGATION_HOST;
  if (loopback) {
    if (mode !== 'development' || !['http:', 'https:'].includes(target.protocol)) reject();
  } else {
    if (!projectHost.test(host) || target.protocol !== 'https:' || target.port) reject();
    if (mode === 'production' ? !production : production || host !== expected) reject();
    if (!/^(?:sb_publishable_[\w-]+|[\w-]+\.[\w-]+\.[\w-]+)$/.test(publicKey)) reject();
    if (serviceKey && !/^(?:sb_secret_[\w-]+|[\w-]+\.[\w-]+\.[\w-]+)$/.test(serviceKey)) reject();
  }
  if (publicKey.startsWith('sb_secret_') || serviceKey?.startsWith('sb_publishable_')) reject();
  for (const [key, role] of [[publicKey, 'anon'], [serviceKey, 'service_role']]) {
    if (!key || !key.includes('.')) continue;
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      if (claims.role !== role || (!loopback && claims.ref !== host.split('.')[0])) reject();
    } catch {
      return reject();
    }
  }
  return { mode, origin: target.origin };
}
