import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const commands = {
  test: ['--test', '--test-isolation=none', 'scripts/*.test.mjs'],
  build: [require.resolve('next/dist/bin/next'), 'build'],
};
const command = commands[process.argv[2]];
if (!command) throw new Error('Comando local inválido.');

const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/SUPABASE|DATABASE|POSTGRES|^PG|^VERCEL|^NVMED_|^NODE_(ENV|OPTIONS)$/i.test(name)));
Object.assign(env, {
  NEXT_PUBLIC_SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  NVMED_ENVIRONMENT: 'development',
  VERCEL: '0',
  VERCEL_ENV: '',
  NEXT_TELEMETRY_DISABLED: '1',
});
const result = spawnSync(process.execPath, command, { env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
