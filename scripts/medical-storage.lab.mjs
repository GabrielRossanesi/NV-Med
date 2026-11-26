// Run only against the disposable PostgreSQL lab. Storage is a loopback fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import sharp from 'sharp';
import { connectStorageDb, sqlValue } from './medical-storage-db.mjs';
import { openBackupRoot } from './medical-storage-backup.mjs';

assert.equal(process.env.NVMED_STORAGE_PROJECT, 'local');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.match(process.env.PGUSER, /^nvmed_[\da-f]{32}$/);

const bucket = 'medical-documents';
const source = 'nv-cli-org/nv-cli-doctor/test.png';
const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: '#12ab3380' } }).png({ compressionLevel: 0 }).toBuffer();
const objects = new Map([[source, { type: 'image/png', bytes: png }]]);
const db = await connectStorageDb();
const session = await db.json('SELECT to_json(current_user::text);');
assert.equal(session, process.env.PGUSER);
const backupRoot = await mkdtemp(join(tmpdir(), 'nvmed-storage-lab-'));
const backupKey = randomBytes(32).toString('base64');
let interruptedUpload = true;

const record = (path, bytes) => db.json(`WITH inserted AS (INSERT INTO storage.objects(bucket_id,name,metadata)
  VALUES ('${bucket}',${sqlValue(path)},jsonb_build_object('size',${bytes})) RETURNING 1) SELECT to_json(count(*)) FROM inserted;`);

const server = createServer(async (request, response) => {
  const prefix = `/storage/v1/object/`;
  const url = new URL(request.url, 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname.split(`${bucket}/`)[1] || '');
  const send = (data, code = 200) => response.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  try {
    if (request.method === 'GET' && objects.has(path)) {
      const item = objects.get(path);
      response.setHeader('Content-Type', item.type);
      if (url.searchParams.has('download')) response.setHeader('Content-Disposition', `attachment; filename="${path.split('/').at(-1)}"`);
      response.end(item.bytes);
    } else if (request.method === 'POST' && url.pathname.startsWith(`${prefix}sign/`)) {
      send({ signedURL: `/object/sign/${bucket}/${path}?token=test` });
    } else if (request.method === 'POST' && path) {
      const body = [];
      for await (const chunk of request) body.push(chunk);
      const bytes = Buffer.concat(body);
      objects.set(path, { type: request.headers['content-type'], bytes });
      await record(path, bytes.length);
      if (interruptedUpload) { interruptedUpload = false; request.socket.destroy(); }
      else send({ Key: `${bucket}/${path}` });
    } else if (request.method === 'DELETE') {
      const body = [];
      for await (const chunk of request) body.push(chunk);
      const { prefixes } = JSON.parse(Buffer.concat(body));
      for (const name of prefixes) {
        objects.delete(name);
        await db.json(`WITH gone AS (DELETE FROM storage.objects WHERE bucket_id='medical-documents' AND name=${sqlValue(name)} RETURNING 1)
          SELECT to_json(count(*)) FROM gone;`);
      }
      send(prefixes.map(name => ({ name })));
    } else send({ error: 'fixture not found' }, 404);
  } catch { send({ error: 'fixture failure' }, 500); }
});

try {
  await db.json(`INSERT INTO public.organizations(id,name,settings) VALUES ('nv-cli-org','Empresa de laboratório','{"specialties":["Cirurgia"],"requiredDocuments":[{"type":"crm","name":"CRM","required":true}]}');
    INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,status) VALUES ('nv-cli-doctor','nv-cli-org','Médico de laboratório','5802','SP','Cirurgia','pending');
    UPDATE public.medical_documents SET file_path=${sqlValue(source)}, status='sent' WHERE doctor_id='nv-cli-doctor' AND type='crm';
    CREATE OR REPLACE FUNCTION public.nv_document_delivery_status(object_name text) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$ SELECT 'not_configured'::text; $$;
    SELECT to_json(true);`);
  await record(source, png.length);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  async function run(exitCode, ...args) {
    const child = spawn(process.execPath, ['scripts/medical-storage.mjs', ...args], { windowsHide: true,
      env: { ...process.env, NVMED_STORAGE_URL: `http://127.0.0.1:${server.address().port}`, NVMED_STORAGE_SERVICE_KEY: 'fixture', NVMED_STORAGE_BACKUP_KEY: backupKey },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => child.once('close', resolve).once('error', reject));
    assert.equal(code, exitCode, stderr + stdout);
    return JSON.parse(stdout);
  }
  const report = await run(0, 'dry-run', '--pdf-sample', '0');
  assert.equal(report.eligibleForAnalysis, 1);
  assert.equal(report.sample.filesWithGain, 1);
  assert.equal(report.sample.before, png.length);
  assert.ok(report.projection.afterBytes < report.totalBytes);
  assert.equal(objects.size, 1);
  const { id, originalSha256, optimizedSha256 } = report.sample.trials[0];
  const path = join(backupRoot, 'approved.json');
  await writeFile(path, JSON.stringify({ project: 'local', strategy: 'legacy-webp-v1', files: [{ id, originalSha256, optimizedSha256 }] }), { mode: 0o600 });
  const args = ['--confirm-project', 'local', '--approved-manifest', path, '--backup-dir', backupRoot, '--batch-size', '1'];
  const stopped = await run(1, 'apply', ...args);
  assert.equal(stopped.results[0].recorded, true);
  assert.equal(objects.size, 2);
  assert.equal(objects.has(source), true);
  const vault = await openBackupRoot(backupRoot, backupKey, 'local');
  const original = await vault.readOriginal(id);
  assert.deepEqual(original.original, png);
  assert.equal(original.references.documents.length, 1);
  assert.match((await run(0, 'apply', ...args)).results[0].outcome, /aguardando/);
  await db.json("UPDATE public.medical_storage_replacements SET switched_at=now()-interval '3 minutes'; SELECT to_json(true);");
  assert.equal((await run(0, 'apply', ...args)).results[0].outcome, 'concluído');
  assert.equal(objects.has(source), false);
  assert.deepEqual((await run(0, 'apply', ...args)).results, []);
  assert.match((await run(0, 'rollback', ...args)).results[0].outcome, /aguardando/);
  assert.equal(objects.has(source), true);
  assert.deepEqual(objects.get(source).bytes, png);
  assert.equal(await db.json('SELECT to_json(count(*)) FROM public.medical_storage_replacements;'), 0);
  const rollback = await vault.readJournal(id);
  mock.timers.enable({ apis: ['Date'], now: Date.now() - 180_000 });
  try { await vault.saveJournal(id, rollback); }
  finally { mock.timers.reset(); }
  assert.equal((await run(0, 'rollback', ...args)).results[0].outcome, 'restaurado');
  assert.deepEqual([...objects.keys()], [source]);
  assert.deepEqual((await run(0, 'rollback', ...args)).results, []);
  console.log(`PASS: dry-run sintético, ${report.sample.before} bytes antes e ${report.sample.after} depois, falha após envio, retomada, backup e rollback de referências.`);
} finally {
  db.close();
  server.closeAllConnections();
  server.close();
}
