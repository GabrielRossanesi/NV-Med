import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const maximumBytes = 25_000_000;

export function scanMedicalBuffer(bytes, connection, timeoutMs = 45_000) {
  if (!bytes.length || bytes.length > maximumBytes) return Promise.resolve('failed');
  return new Promise(resolve => {
    const socket = createConnection(connection);
    const timer = setTimeout(() => finish('failed'), timeoutMs);
    let response = '';

    function finish(verdict) {
      clearTimeout(timer);
      socket.destroy();
      resolve(verdict);
    }

    socket.once('error', () => finish('failed'));
    socket.once('close', () => finish('failed'));
    socket.once('connect', () => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      socket.write('zINSTREAM\0');
      socket.write(length);
      socket.write(bytes);
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', chunk => {
      response += chunk.toString('utf8');
      if (response.length > 1024) return finish('failed');
      if (!response.endsWith('\0')) return;
      if (response === 'stream: OK\0') return finish('clean');
      return finish(/^stream: [^\0\r\n]+ FOUND\0$/.test(response) ? 'blocked' : 'failed');
    });
  });
}

export async function scanMedicalDocuments(client, scan, limit) {
  const totals = { clean: 0, blocked: 0, failed: 0, interrupted: 0 };
  for (let index = 0; index < limit; index++) {
    const { data: job, error: claimError } = await client.rpc('nv_claim_medical_scan');
    if (claimError) throw new Error('Não foi possível reservar a verificação.');
    if (!job) break;
    let verdict = 'failed';
    try {
      const { data: file, error } = await client.storage.from('medical-documents').download(job.path);
      if (!error && file?.size > 0 && file.size <= maximumBytes) {
        verdict = await scan(Buffer.from(await file.arrayBuffer()));
      }
    } catch { /* Keep quarantine when the download or scanner fails. */ }
    const { data: finished, error: finishError } = await client.rpc('nv_finish_medical_scan', { claim: job.claim_id, verdict });
    if (finishError) throw new Error('Não foi possível gravar o resultado da verificação.');
    totals[finished ? verdict : 'interrupted']++;
    if (verdict === 'failed') break;
  }
  return totals;
}

async function main() {
  const url = new URL(process.env.NVMED_SCAN_SUPABASE_URL ?? '');
  const key = process.env.NVMED_SCAN_SERVICE_ROLE_KEY;
  const limit = Number(process.argv[2] ?? 50);
  if (!key || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.href !== `${url.origin}/` || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Confira as credenciais do ambiente de verificação e o limite de 1 a 1000 arquivos.');
  }
  const connection = process.env.NVMED_CLAMD_SOCKET ? { path: process.env.NVMED_CLAMD_SOCKET } : { host: '127.0.0.1', port: 3310 };
  const client = createClient(url.origin, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }) },
  });
  const totals = await scanMedicalDocuments(client, bytes => scanMedicalBuffer(bytes, connection), limit);
  console.log(JSON.stringify(totals));
  if (totals.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof TypeError ? 'Configuração do verificador inválida.' : error.message);
    process.exitCode = 1;
  });
}
