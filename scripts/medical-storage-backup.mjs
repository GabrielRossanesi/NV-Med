import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from './medical-storage-media.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

export async function openBackupRoot(path, base64key, project) {
  if (!path || !isAbsolute(path)) throw new Error('Informe o caminho absoluto de um diretório protegido fora do repositório.');
  const root = await realpath(path);
  const inside = relative(await realpath(repository), root);
  if (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) throw new Error('O backup precisa ficar fora do repositório.');
  const key = Buffer.from(base64key || '', 'base64');
  if (key.length !== 32) throw new Error('A chave de backup deve conter 32 bytes em Base64.');
  const directory = join(root, project);
  await mkdir(directory, { mode: 0o700, recursive: true });
  if (await realpath(directory) !== directory) throw new Error('O diretório de backup deve ser um caminho local direto.');

  function file(id, type) { return join(directory, `${id}.${type}.aes`); }
  function aad(id, type) { return Buffer.from(`nvmed-storage-v1/${project}/${id}/${type}`); }

  async function read(id, type) {
    const sealed = await readFile(file(id, type)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!sealed) return null;
    const decoder = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
    decoder.setAAD(aad(id, type));
    decoder.setAuthTag(sealed.subarray(12, 28));
    return JSON.parse(Buffer.concat([decoder.update(sealed.subarray(28)), decoder.final()]).toString('utf8'));
  }

  async function write(id, type, data) {
    const iv = randomBytes(12);
    const encoder = createCipheriv('aes-256-gcm', key, iv);
    encoder.setAAD(aad(id, type));
    const encoded = Buffer.concat([encoder.update(JSON.stringify(data), 'utf8'), encoder.final()]);
    const target = file(id, type);
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(Buffer.concat([iv, encoder.getAuthTag(), encoded])); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, target);
    return read(id, type);
  }

  return {
    async readOriginal(id) {
      const backup = await read(id, 'original');
      if (!backup) return null;
      const bytes = Buffer.from(backup.data, 'base64');
      if (bytes.length !== backup.bytes || digest(bytes) !== backup.sha256 || backup.id !== id) throw new Error('Backup não íntegro.');
      return { ...backup, original: bytes };
    },
    async saveOriginal(id, bytes, manifest) {
      if (!await read(id, 'original')) {
        await write(id, 'original', { ...manifest, id, bytes: bytes.length, sha256: digest(bytes), data: bytes.toString('base64') });
      }
      return this.readOriginal(id);
    },
    readJournal: id => read(id, 'journal'),
    saveJournal: (id, record) => write(id, 'journal', { ...record, at: new Date().toISOString() }),
    saveFailure: (id, reason) => write(id, 'failure', { reason, at: new Date().toISOString() }),
  };
}
