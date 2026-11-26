import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function connectStorageDb() {
  const processEnv = { ...process.env, PGCONNECT_TIMEOUT: '8', PGCLIENTENCODING: 'UTF8' };
  const db = spawn(process.env.NVMED_STORAGE_PSQL || 'psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { env: processEnv, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const lines = createInterface({ input: db.stdout });
  let current;
  let failed = false;
  function stop() {
    failed = true;
    current?.reject(new Error('PostgreSQL indisponível ou consulta recusada. Confira o projeto, o acesso e a etapa da migration.'));
    current = undefined;
  }
  db.on('error', stop);
  db.on('close', stop);
  db.stdin.on('error', stop);
  lines.on('line', line => {
    if (!current) return;
    if (line === 'nvmed-query-complete') {
      const query = current;
      current = undefined;
      query.resolve(query.lines);
    } else current.lines.push(line);
  });
  function execute(sql) {
    if (failed || current) throw new Error('Sessão PostgreSQL indisponível. Retome a execução.');
    return new Promise((resolve, reject) => {
      current = { resolve, reject, lines: [] };
      db.stdin.write(`${sql.trim()}\n\\echo nvmed-query-complete\n`);
    });
  }
  const connection = {
    async json(sql) {
      const result = await execute(sql);
      try { return JSON.parse(result.join('\n')); }
      catch { throw new Error('Resposta inesperada do catálogo.'); }
    },
    close() { db.stdin.end('\\q\n'); },
  };
  try { await execute("SET statement_timeout = '30s'; SET lock_timeout = '5s'; SET standard_conforming_strings = on;"); }
  catch (error) { connection.close(); throw error; }
  return connection;
}

export const readOnly = sql => `BEGIN READ ONLY;\n${sql}\nCOMMIT;`;

export async function loadStorageInventory(db) {
  const { aliases } = await db.json(readOnly("SELECT json_build_object('aliases', to_regclass('public.medical_storage_replacements') IS NOT NULL);"));
  const replacementRelations = aliases ? 'SELECT source_path, stored_path FROM public.medical_storage_replacements' : 'SELECT NULL::text, NULL::text WHERE false';
  return db.json(readOnly(`
WITH replacements(source_path, stored_path) AS (${replacementRelations}),
  refs AS (
    SELECT file_path AS path, organization_id AS org, doctor_id AS doctor, nullif(file_url, '') IS NOT NULL AS has_url FROM public.medical_documents
    UNION ALL SELECT path, organization_id, doctor_id, false FROM public.document_audit_logs a CROSS JOIN LATERAL
      (VALUES (a.changes->>'filePath'), (a.changes->>'previousFilePath')) AS revisions(path)
  ), paths AS (
    SELECT path, count(*) AS refs, bool_or(has_url) AS url,
      bool_and(public.nv_document_path_matches(org, doctor, path)) AS scoped
    FROM refs WHERE path IS NOT NULL GROUP BY path
  ), avatar_owners AS (
    SELECT avatar, CASE WHEN count(DISTINCT organization_id) = 1 AND bool_and(organization_id IS NOT NULL)
      THEN min(organization_id) END AS org
    FROM public.user_accounts WHERE avatar IS NOT NULL GROUP BY avatar
  ), catalog AS (
    SELECT o.bucket_id AS bucket, o.name AS path, b.public,
      CASE WHEN to_jsonb(o)->'metadata'->>'size' ~ '^[0-9]{1,15}$' THEN (to_jsonb(o)->'metadata'->>'size')::bigint END AS bytes,
      to_jsonb(o)->>'version' AS version,
      coalesce(p.refs, 0) AS refs, coalesce(p.scoped, false) AS scoped, coalesce(p.url, false) AS url,
      r.source_path IS NOT NULL AS is_replacement, previous.stored_path AS replaced_by,
      CASE WHEN o.bucket_id = 'profile-avatars' THEN owner.org
           WHEN o.bucket_id IN ('medical-documents','finance-receipts') THEN org.id END AS company,
      CASE WHEN o.bucket_id = 'profile-avatars' THEN owner.avatar IS NOT NULL END AS avatar_referenced
    FROM storage.objects o JOIN storage.buckets b ON b.id = o.bucket_id
    LEFT JOIN replacements r ON o.bucket_id = 'medical-documents' AND r.stored_path = o.name
    LEFT JOIN replacements previous ON o.bucket_id = 'medical-documents' AND previous.source_path = o.name
    LEFT JOIN paths p ON o.bucket_id = 'medical-documents' AND p.path = coalesce(r.source_path, o.name)
    LEFT JOIN public.organizations org ON o.bucket_id IN ('medical-documents','finance-receipts') AND org.id = split_part(o.name, '/', 1)
    LEFT JOIN avatar_owners owner ON o.bucket_id = 'profile-avatars' AND owner.avatar = o.name
    WHERE o.name IS NOT NULL AND o.name NOT LIKE '%/.emptyFolderPlaceholder' AND o.name <> '.emptyFolderPlaceholder'
  )
SELECT json_build_object('objects', coalesce((SELECT json_agg(c ORDER BY bucket,path) FROM catalog c), '[]'),
  'buckets', (SELECT json_agg(id ORDER BY id) FROM storage.buckets),
  'legacy_urls', (SELECT count(*) FROM public.medical_documents WHERE file_url IS NOT NULL AND file_url <> ''),
  'as_of', statement_timestamp());`));
}
