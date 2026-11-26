import { formatStorageBytes } from './storageUsage';
import { maxMedicalFileBytes, medicalFileExtension, medicalImagePolicy, normalizeMedicalFilename } from './medicalFile';
import { notify } from './notifications';

export type DocumentUploadPhase = 'Validando documento…' | 'Otimizando arquivo…' | 'Enviando documento…';
export type DocumentUploadOptions = { preserveOriginal?: boolean; onPhase?: (phase: DocumentUploadPhase) => void };

const activeUploads = new Set<string>();
const uploadErrors: Record<number, string> = {
  400: 'Selecione um único arquivo.',
  403: 'A sessão não permite este envio. Atualize a página.',
  404: 'Documento indisponível para envio.',
  409: 'Não foi possível confirmar o envio. Atualize a pasta antes de tentar novamente.',
  413: 'O limite de envio é de 4 MB por arquivo.',
  415: 'Selecione um PDF, JPEG, PNG ou WebP válido, dentro dos limites de imagem.',
  429: 'Limite de envios atingido. Tente novamente em alguns minutos.',
};

export async function sendMedicalDocument(id: string, original: File, options: DocumentUploadOptions = {}) {
  if (activeUploads.has(id)) throw new Error('Já existe um envio em andamento para este documento.');
  activeUploads.add(id);
  try {
    options.onPhase?.('Validando documento…');
    const canOptimize = !options.preserveOriginal && /^image\/(jpeg|png)$/.test(original.type);
    const limit = canOptimize ? medicalImagePolicy.maxSourceBytes : maxMedicalFileBytes;
    if (original.size > limit) throw new Error(`O limite para este arquivo é de ${formatStorageBytes(limit)}.`);
    const kind = await medicalFileExtension(original, limit);
    if (!kind) throw new Error(uploadErrors[415]);
    let file = original;
    if (canOptimize && (kind === 'jpg' || kind === 'png')) {
      options.onPhase?.('Otimizando arquivo…');
      const blob = await import('./medicalImageClient').then(({ optimizeInWorker }) => optimizeInWorker(original, kind)).catch(() => null);
      if (blob) file = new File([blob], normalizeMedicalFilename(original.name, 'webp'), { type: blob.type });
    }
    if (file.size > maxMedicalFileBytes) throw new Error(uploadErrors[413]);
    const body = new FormData();
    body.set('file', file);
    if (file !== original) {
      body.set('originalBytes', String(original.size));
      body.set('originalFormat', kind);
    }
    options.onPhase?.('Enviando documento…');
    const response = await fetch('/api/portal/documents/' + encodeURIComponent(id), { method: 'POST', body,
      signal: AbortSignal.timeout(60_000) }).catch(() => { throw new Error(uploadErrors[409]); });
    if (!response.ok) throw new Error(uploadErrors[response.status] || 'Não foi possível enviar o documento. Tente novamente.');
    const result = await response.json().catch(() => null);
    if (result?.saved !== true) throw new Error(uploadErrors[409]);
    const description = file !== original ? `Arquivo otimizado de ${formatStorageBytes(original.size)} para ${formatStorageBytes(file.size)}.` : undefined;
    if (result.scanning) notify.info('Documento enviado para verificação de segurança.', { description });
    else notify.success('Documento enviado com sucesso.', { description });
  } finally {
    activeUploads.delete(id);
  }
}
