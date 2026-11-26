import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { connectStorageDb, loadStorageInventory, readOnly, sqlValue } from './medical-storage-db.mjs';
import { openBackupRoot } from './medical-storage-backup.mjs';
import { digest, inspectPreservedPdf, optimizeLegacyImage, storageCandidateId } from './medical-storage-media.mjs';
import { medicalImagePolicy } from '../src/lib/medicalFile.ts';

const bucket = 'medical-documents';
const strategy = 'legacy-' + medicalImagePolicy.version;
const signedUrlGraceSeconds = 120;
const defaultLimitBytes = 1_000_000_000;
const sha = /^[0-9a-f]{64}$/;
const safeSource = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:jpe?g|png)$/;
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; process.stderr.write('Interrupção solicitada. Concluindo a etapa atual.\n'); });

const formatOf = path => (path.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase() || 'outros').replace(/^jpeg$/, 'jpg');
const sumBytes = rows => rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
const summarize = (rows, group) => Array.from(Map.groupBy(rows, group), ([label, items]) => ({ label, files: items.length, bytes: sumBytes(items) }))
  .sort((left, right) => right.bytes - left.bytes);
const candidate = row => row.bucket === bucket && !row.public && row.scoped && row.refs > 0 && !row.url && !row.is_replacement && !row.replaced_by
  && Boolean(row.version) && row.bytes > 0 && row.bytes <= medicalImagePolicy.maxSourceBytes && safeSource.test(row.path);

function numberOption(raw, fallback, max) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('Parâmetro numérico fora do limite.');
  return value;
}

function sampleAcrossSizes(rows, count) {
  const sorted = rows.toSorted((left, right) => left.bytes - right.bytes || left.path.localeCompare(right.path));
  const size = Math.min(count, sorted.length);
  return Array.from({ length: size }, (_, i) => sorted[Math.floor((i + 0.5) * sorted.length / size)]);
}

async function download(storage, path, maximum) {
  const response = await storage.download(path);
  if (response.error || !response.data || response.data.size > maximum) throw new Error('Download do objeto indisponível ou fora do limite.');
  return Buffer.from(await response.data.arrayBuffer());
}

async function dryRun(db, storage, limit, samples, pdfSamples) {
  const inventory = await loadStorageInventory(db);
  const { objects } = inventory;
  const eligible = objects.filter(candidate);
  const orphans = objects.filter(row => (row.bucket === bucket && !row.refs) || (row.bucket === 'profile-avatars' && !row.avatar_referenced));
  const totalBytes = sumBytes(objects);
  let projected = 0;
  const trials = [];
  for (const [kind, rows] of Map.groupBy(eligible, row => formatOf(row.path))) {
    let before = 0;
    let after = 0;
    const selected = sampleAcrossSizes(rows, samples);
    for (const row of selected) {
      if (interrupted) break;
      const id = storageCandidateId(row.path);
      try {
        const original = await download(storage, row.path, medicalImagePolicy.maxSourceBytes);
        if (original.length !== row.bytes) throw new Error('Objeto atualizado.');
        const output = await optimizeLegacyImage(original, kind);
        before += original.length;
        after += output?.length ?? original.length;
        trials.push({ id, format: kind, before: original.length, after: output?.length ?? original.length,
          ...(output && { originalSha256: digest(original), optimizedSha256: digest(output) }) });
      } catch { trials.push({ id, format: kind, issue: 'amostra indisponível ou inválida' }); }
    }
    if (before) projected += Math.round(sumBytes(rows) * (before - after) / before);
  }
  const pdfDetails = {};
  for (const row of sampleAcrossSizes(objects.filter(item => item.bucket === bucket && !item.public && item.bytes > 0
    && item.bytes <= 10_000_000 && formatOf(item.path) === 'pdf'), pdfSamples)) {
    if (interrupted) break;
    let result = 'unavailable';
    try { result = await inspectPreservedPdf(await download(storage, row.path, 10_000_000)); }
    catch { /* A missing or invalid sample still remains untouched. */ }
    pdfDetails[result] = (pdfDetails[result] ?? 0) + 1;
  }
  const measured = trials.reduce((total, trial) => ({ before: total.before + (trial.before ?? 0), after: total.after + (trial.after ?? 0) }), { before: 0, after: 0 });
  const sampleBytesSaved = measured.before - measured.after;
  const distinctPaths = rows => rows.map(row => ({ id: storageCandidateId(`${row.bucket}/${row.path}`), bucket: row.bucket, bytes: row.bytes, format: formatOf(row.path) }));
  const hasEstimate = (measured.before > 0 || eligible.length === 0) && !inventory.legacy_urls;
  const byBucket = new Map(summarize(objects, row => row.bucket).map(item => [item.label, item]));
  return {
    mode: 'dry-run', asOf: inventory.as_of, files: objects.length, limitBytes: limit, totalBytes, availableBytes: Math.max(0, limit - totalBytes),
    filesWithoutSize: objects.filter(row => row.bytes === null).length,
    byFormat: summarize(objects, row => formatOf(row.path)),
    byBucket: inventory.buckets.map(label => byBucket.get(label) ?? { label, files: 0, bytes: 0 }),
    byCompany: summarize(objects, row => row.company || 'Sem empresa identificada'),
    eligibleForAnalysis: eligible.length, eligibleBytes: sumBytes(eligible), preserved: objects.length - eligible.length,
    legacyUrls: inventory.legacy_urls, possibleOrphans: { count: orphans.length, bytes: sumBytes(orphans), examples: distinctPaths(orphans.slice(0, 10)) },
    largest: distinctPaths(objects.toSorted((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0)).slice(0, 10)),
    pdfSample: pdfDetails, sample: { ...measured, bytesSaved: sampleBytesSaved, filesWithGain: trials.filter(row => row.after < row.before).length, trials },
    projection: hasEstimate && !interrupted ? { savedBytes: projected, savedPercent: totalBytes ? projected / totalBytes * 100 : 0, afterBytes: totalBytes - projected } : null,
    interrupted,
  };
}

async function reviewOne(id, db, connection) {
  if (!sha.test(id)) throw new Error('Informe o identificador da amostra em --candidate-id.');
  const inventory = await loadStorageInventory(db);
  const row = inventory.objects.find(item => candidate(item) && storageCandidateId(item.path) === id);
  if (!row) throw new Error('Amostra elegível não encontrada.');
  const original = await download(connection.storage, row.path, medicalImagePolicy.maxSourceBytes);
  if (original.length !== row.bytes) throw new Error('O original mudou desde o inventário.');
  const optimized = await optimizeLegacyImage(original, formatOf(row.path));
  if (!optimized) throw new Error('A amostra não apresentou ganho com os critérios atuais.');
  const token = '/' + randomUUID();
  const page = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Comparação de documentos</title><h1>Comparação de documentos</h1><p>Compare os dois arquivos no tamanho original. Amplie textos, assinaturas, carimbos e códigos.</p>'
    + `<section><h2>Original</h2><img src="${token}/original" alt="Documento original"></section>`
    + `<section><h2>WebP</h2><img src="${token}/webp" alt="Documento convertido em WebP"></section>`;
  const server = createServer((request, response) => {
    const resource = new Map([[token, ['text/html; charset=utf-8', page]], [`${token}/original`, [mimeOf(row.path), original]], [`${token}/webp`, ['image/webp', optimized]]]).get(request.url);
    if (request.method !== 'GET' || !resource) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': resource[0], 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; frame-ancestors 'none'" });
    response.end(resource[1]);
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const close = () => { server.closeAllConnections(); server.close(); };
  const timer = setTimeout(close, 5 * 60_000);
  process.once('SIGINT', close);
  const approval = { id, originalSha256: digest(original), optimizedSha256: digest(optimized) };
  process.stdout.write(`Prévia temporária: http://127.0.0.1:${server.address().port}${token}\n${JSON.stringify(approval)}\n`);
  await new Promise(resolve => server.once('close', resolve));
  clearTimeout(timer);
  process.off('SIGINT', close);
  return { mode: 'review', project: connection.project, strategy, candidate: approval };
}

async function projectOptions(options, mode) {
  const url = new URL(process.env.NVMED_STORAGE_URL || 'https://invalid.invalid');
  const project = process.env.NVMED_STORAGE_PROJECT;
  const key = process.env.NVMED_STORAGE_SERVICE_KEY;
  const local = project === 'local' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/$/.test(url.href);
  if (!key || (!local && (!/^[a-z0-9]{20}$/.test(project) || url.href !== `https://${project}.supabase.co/`
    || process.env.PGUSER !== `postgres.${project}` || process.env.PGDATABASE !== 'postgres' || process.env.PGSSLMODE !== 'verify-full' || !process.env.PGHOST?.endsWith('.pooler.supabase.com')
    || process.env.PGHOSTADDR || process.env.PGSERVICE))) throw new Error('Confirme as credenciais, a referência do projeto e TLS verify-full no pooler.');
  const supabase = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error',
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }),
  } });
  if (mode !== 'dry-run' && options['confirm-project'] !== project) throw new Error('Informe a referência do projeto em --confirm-project.');
  return { project, storage: supabase.storage.from(bucket), url };
}

async function signedContent(connection, path, hash, mime) {
  for (const attachment of [false, true]) {
    const result = await connection.storage.createSignedUrl(path, 60, { download: attachment });
    if (result.error || !result.data) throw new Error('A URL assinada do objeto não pôde ser criada.');
    const url = new URL(result.data.signedUrl);
    if (url.origin !== connection.url.origin || !url.pathname.startsWith(`/storage/v1/object/sign/${bucket}/`)) {
      throw new Error('Origem do objeto assinado inválida.');
    }
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== mime
      || (attachment && !response.headers.get('content-disposition')?.startsWith('attachment'))
      || digest(Buffer.from(await response.arrayBuffer())) !== hash) throw new Error('A conferência de visualização e download falhou.');
  }
}

const optimizationPath = (source, id, optimizedHash) => `${source.slice(0, source.lastIndexOf('/'))}/nv-opt-${id.slice(0, 24)}-${optimizedHash.slice(0, 24)}.webp`;
const mimeOf = path => formatOf(path) === 'jpg' ? 'image/jpeg' : `image/${formatOf(path)}`;

async function recordState(db, source, target) {
  const pair = [source, target].map(sqlValue).join(', ');
  return db.json(readOnly(`
    SELECT json_build_object(
      'replacement', (SELECT to_jsonb(r) || jsonb_build_object('old_url_expired', switched_at < clock_timestamp() - interval '${signedUrlGraceSeconds} seconds')
        FROM public.medical_storage_replacements r WHERE source_path = ${sqlValue(source)}),
      'objects', coalesce((SELECT json_agg(json_build_object('path', o.name, 'version', o.version,
        'bytes', (to_jsonb(o)->'metadata'->>'size')::bigint, 'metadata', to_jsonb(o)->'metadata', 'userMetadata', to_jsonb(o)->'user_metadata'))
        FROM storage.objects o WHERE o.bucket_id = 'medical-documents' AND o.name IN (${pair})), '[]'),
      'documents', coalesce((SELECT json_agg(d) FROM public.medical_documents d WHERE d.file_path IN (${pair})), '[]'),
      'history', coalesce((SELECT json_agg(a) FROM public.document_audit_logs a
        WHERE a.changes->>'filePath' IN (${pair}) OR a.changes->>'previousFilePath' IN (${pair})), '[]'),
      'legacyUrls', (SELECT count(*) FROM public.medical_documents WHERE file_url IS NOT NULL AND file_url <> ''),
      'delivery', public.nv_document_delivery_status(${sqlValue(source)}),
      'private', (SELECT NOT public FROM storage.buckets WHERE id = 'medical-documents')
    );`));
}

function assertReferences(state, source, target) {
  const [organization, doctor] = source.split('/');
  const refs = [...state.documents, ...state.history];
  if (!state.private || state.legacyUrls || !refs.length || refs.some(ref => ref.organization_id !== organization || ref.doctor_id !== doctor
    || ref.file_path === target || ref.changes?.filePath === target || ref.changes?.previousFilePath === target)) {
    throw new Error('As referências de origem não puderam ser comprovadas.');
  }
}

function assertMapping(mapping, backup, target, approved) {
  if (!mapping || mapping.stored_path !== target || mapping.original_sha256 !== backup.sha256 || mapping.stored_sha256 !== approved.optimizedSha256) {
    throw new Error('A substituição registrada diverge do manifesto.');
  }
}

async function ensureHeadroom(db, limit, size) {
  const inventory = await loadStorageInventory(db);
  if (inventory.objects.some(row => row.bytes === null)) throw new Error('O catálogo não informa o tamanho de todos os objetos.');
  if (sumBytes(inventory.objects) + size > limit) throw new Error('Espaço insuficiente para a troca com ambos os arquivos disponíveis.');
}

async function applyOne(db, connection, vault, approved, row, limit) {
  let backup = await vault.readOriginal(approved.id);
  const source = backup?.source ?? row?.path;
  if (!source || !safeSource.test(source) || storageCandidateId(source) !== approved.id) throw new Error('Origem elegível não encontrada.');
  const target = optimizationPath(source, approved.id, approved.optimizedSha256);
  let state = await recordState(db, source, target);
  assertReferences(state, source, target);
  if (state.delivery !== 'not_configured') throw new Error('A substituição local está indisponível quando a quarentena está ativa.');
  const original = state.objects.find(object => object.path === source);
  if (!backup) {
    if (!original || !row || !candidate(row) || original.version !== row.version) throw new Error('A origem mudou desde o inventário.');
    const bytes = await download(connection.storage, source, medicalImagePolicy.maxSourceBytes);
    if (bytes.length !== original.bytes || digest(bytes) !== approved.originalSha256) throw new Error('O conteúdo original diverge do manifesto aprovado.');
    backup = await vault.saveOriginal(approved.id, bytes, {
      source, target, version: original.version, mime: mimeOf(source), strategy, storage: { metadata: original.metadata, userMetadata: original.userMetadata },
      references: { documents: state.documents, history: state.history },
    });
  }
  if (backup.sha256 !== approved.originalSha256 || backup.target !== target || backup.strategy !== strategy
    || !backup.references.documents.length && !backup.references.history.length) throw new Error('O backup diverge do manifesto aprovado.');
  if (original && original.version !== backup.version) throw new Error('A versão de origem mudou desde o backup.');

  if (!state.replacement) {
    if (!original) throw new Error('A origem não existe e nenhuma substituição está registrada.');
    const output = await optimizeLegacyImage(backup.original, formatOf(source));
    if (!output || digest(output) !== approved.optimizedSha256) throw new Error('A imagem processada diverge da cópia revisada.');
    if (!state.objects.some(object => object.path === target)) {
      await ensureHeadroom(db, limit, output.length);
      const upload = await connection.storage.upload(target, output, { upsert: false, contentType: 'image/webp', cacheControl: '0' });
      if (upload.error) throw new Error('O novo objeto não foi confirmado. Retome para reconciliar.');
    }
    await signedContent(connection, target, approved.optimizedSha256, 'image/webp');
    const [organization, doctor] = source.split('/');
    const values = [source, target, organization, doctor, backup.bytes, output.length, backup.sha256, approved.optimizedSha256, strategy].map(sqlValue);
    const stored = await db.json(`WITH saved AS (
      INSERT INTO public.medical_storage_replacements(source_path, stored_path, organization_id, doctor_id, original_bytes, stored_bytes,
        original_sha256, stored_sha256, strategy) SELECT ${values.join(', ')}
      WHERE EXISTS (SELECT FROM storage.objects o WHERE o.bucket_id = 'medical-documents' AND o.name = ${sqlValue(source)} AND o.version::text = ${sqlValue(backup.version)})
        AND EXISTS (SELECT FROM storage.objects o WHERE o.bucket_id = 'medical-documents' AND o.name = ${sqlValue(target)})
      ON CONFLICT DO NOTHING RETURNING true
    ) SELECT to_json(EXISTS (SELECT FROM saved));`);
    if (!stored) throw new Error('A troca não foi confirmada. Aguarde a reconciliação.');
    await vault.saveJournal(approved.id, { phase: 'switched', source, target });
    state = await recordState(db, source, target);
  }

  assertMapping(state.replacement, backup, target, approved);
  assertReferences(state, source, target);
  if (!state.objects.some(object => object.path === source)) return 'concluído';
  if (!state.replacement.old_url_expired || interrupted) return 'aguardando expiração de URLs anteriores';
  await signedContent(connection, target, approved.optimizedSha256, 'image/webp');
  const latest = await recordState(db, source, target);
  assertMapping(latest.replacement, backup, target, approved);
  assertReferences(latest, source, target);
  if (latest.delivery !== 'not_configured' || latest.objects.find(object => object.path === source)?.version !== backup.version) {
    throw new Error('A origem foi alterada após a validação.');
  }
  const removal = await connection.storage.remove([source]);
  if (removal.error || (await recordState(db, source, target)).objects.some(object => object.path === source)) {
    throw new Error('A remoção da origem não foi confirmada. Retome para reconciliar.');
  }
  await vault.saveJournal(approved.id, { phase: 'completed', source, target });
  return 'concluído';
}

async function rollbackOne(db, connection, vault, approved, limit) {
  const backup = await vault.readOriginal(approved.id);
  if (!backup || backup.sha256 !== approved.originalSha256 || !safeSource.test(backup.source)
    || backup.target !== optimizationPath(backup.source, approved.id, approved.optimizedSha256)) throw new Error('Backup aprovado não encontrado.');
  const { source, target } = backup;
  let state = await recordState(db, source, target);
  assertReferences(state, source, target);
  if (state.delivery !== 'not_configured') throw new Error('A restauração local está indisponível quando a quarentena está ativa.');
  if (state.replacement) assertMapping(state.replacement, backup, target, approved);
  if (!state.objects.some(object => object.path === source)) {
    if (!state.replacement) throw new Error('A origem está ausente e não existe substituição correspondente.');
    await ensureHeadroom(db, limit, backup.bytes);
    const cacheControl = /^max-age=(\d+)$/.exec(backup.storage?.metadata?.cacheControl || '')?.[1] ?? '0';
    const uploaded = await connection.storage.upload(source, backup.original, { upsert: false, contentType: backup.mime,
      cacheControl, metadata: backup.storage?.userMetadata ?? undefined });
    if (uploaded.error) throw new Error('A restauração não foi confirmada. Retome para reconciliar.');
  }
  await signedContent(connection, source, backup.sha256, backup.mime);
  const journal = await vault.readJournal(approved.id);
  if (state.replacement || !['rollback-switched', 'restored'].includes(journal?.phase)) {
    if (state.replacement) {
      const removed = await db.json(`WITH restored AS (DELETE FROM public.medical_storage_replacements WHERE source_path = ${sqlValue(source)}
        AND stored_path = ${sqlValue(target)} AND stored_sha256 = ${sqlValue(approved.optimizedSha256)} RETURNING 1)
        SELECT to_json(EXISTS (SELECT FROM restored));`);
      if (!removed) throw new Error('A restauração de referências não foi confirmada.');
    }
    await vault.saveJournal(approved.id, { phase: 'rollback-switched', source, target });
    return 'aguardando expiração de URLs da versão WebP';
  }
  state = await recordState(db, source, target);
  assertReferences(state, source, target);
  if (state.replacement) throw new Error('A referência mudou após a restauração.');
  if (Date.now() - Date.parse(journal.at) < signedUrlGraceSeconds * 1000 || interrupted) return 'aguardando expiração de URLs da versão WebP';
  if (state.objects.some(object => object.path === target)) {
    await signedContent(connection, target, approved.optimizedSha256, 'image/webp');
    const removed = await connection.storage.remove([target]);
    if (removed.error || (await recordState(db, source, target)).objects.some(object => object.path === target)) throw new Error('A remoção da cópia WebP não foi confirmada.');
  }
  await vault.saveJournal(approved.id, { phase: 'restored', source, target });
  return 'restaurado';
}

async function runBatch(mode, options, connection, db, limit) {
  if (!options['approved-manifest']) throw new Error('Informe o manifesto dos arquivos revisados e autorizados.');
  const manifest = JSON.parse(await readFile(options['approved-manifest'], 'utf8'));
  if (manifest.project !== connection.project || manifest.strategy !== strategy || !Array.isArray(manifest.files) || !manifest.files.length
    || manifest.files.some(row => !sha.test(row.id) || !sha.test(row.originalSha256) || !sha.test(row.optimizedSha256))
    || new Set(manifest.files.map(row => row.id)).size !== manifest.files.length) throw new Error('Manifesto revisado inválido.');
  const batchSize = numberOption(options['batch-size'], 3, 20);
  if (!batchSize) throw new Error('O lote deve conter ao menos um arquivo.');
  const vault = await openBackupRoot(options['backup-dir'], process.env.NVMED_STORAGE_BACKUP_KEY, connection.project);
  if (!await db.json('SELECT to_json(pg_try_advisory_lock(478668, 57));')) throw new Error('Já existe um processo de acervo neste projeto.');
  const catalog = await loadStorageInventory(db);
  const byId = new Map(catalog.objects.filter(object => object.bucket === bucket).map(row => [storageCandidateId(row.path), row]));
  const results = [];
  let failed = 0;
  for (const approved of manifest.files) {
    if (interrupted || results.length >= batchSize) break;
    try {
      const journal = await vault.readJournal(approved.id);
      if ((mode === 'apply' && journal?.phase === 'completed') || (mode === 'rollback' && journal?.phase === 'restored')) continue;
      const outcome = mode === 'apply' ? await applyOne(db, connection, vault, approved, byId.get(approved.id), limit)
        : await rollbackOne(db, connection, vault, approved, limit);
      results.push({ id: approved.id, outcome });
    } catch (error) {
      failed++;
      const recorded = await vault.saveFailure(approved.id, error.message).then(() => true, () => false);
      results.push({ id: approved.id, outcome: 'falha', reason: error.message, recorded });
    }
  }
  return { mode, results, failed, interrupted };
}

async function main() {
  const { values: options, positionals } = parseArgs({ allowPositionals: true, options: {
    sample: { type: 'string' }, 'pdf-sample': { type: 'string' }, 'limit-bytes': { type: 'string' }, 'batch-size': { type: 'string' },
    'confirm-project': { type: 'string' }, 'approved-manifest': { type: 'string' }, 'backup-dir': { type: 'string' }, 'candidate-id': { type: 'string' },
  } });
  const [mode = 'dry-run'] = positionals;
  if (positionals.length > 1 || !['dry-run', 'review', 'apply', 'rollback'].includes(mode)) throw new Error('Use dry-run, review, apply ou rollback.');
  const connection = await projectOptions(options, mode);
  const db = await connectStorageDb();
  try {
    let configuredLimit = defaultLimitBytes;
    if (options['limit-bytes'] === undefined
      && await db.json(readOnly("SELECT to_json(to_regclass('public.storage_usage_snapshot') IS NOT NULL);"))) {
      configuredLimit = await db.json(readOnly('SELECT to_json(limit_bytes) FROM public.storage_usage_snapshot WHERE id;'));
    }
    const limit = numberOption(options['limit-bytes'], configuredLimit, 1e15);
    if (!limit) throw new Error('O limite precisa ser maior que zero.');
    let result;
    if (mode === 'dry-run') result = await dryRun(db, connection.storage, limit, numberOption(options.sample, 8, 40), numberOption(options['pdf-sample'], 5, 40));
    else if (mode === 'review') result = await reviewOne(options['candidate-id'], db, connection);
    else result = await runBatch(mode, options, connection, db, limit);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (interrupted) process.exitCode = 130;
    else if (result.failed) process.exitCode = 1;
  } finally { db.close(); }
}

main().catch(error => {
  process.stderr.write(`Operação encerrada: ${error.message}\n`);
  process.exitCode = 1;
});
