'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Upload } from 'lucide-react';
import { medicalFileAccept } from '@/lib/medicalFile';
import type { DocumentUploadOptions, DocumentUploadPhase } from '@/lib/medicalUpload';

export default function MedicalDocumentUpload({ name, replace, disabled, onUpload }: {
  name: string;
  replace?: boolean;
  disabled?: boolean;
  onUpload: (file: File, options: DocumentUploadOptions) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [file, setFile] = useState<File>();
  const [preserve, setPreserve] = useState(false);
  const [phase, setPhase] = useState<DocumentUploadPhase>();

  async function upload() {
    if (!file || disabled || lock.current) return;
    lock.current = true;
    setPhase('Validando documento…');
    try {
      if (await onUpload(file, { preserveOriginal: preserve, onPhase: setPhase })) {
        setFile(undefined);
        setPreserve(false);
        if (input.current) input.current.value = '';
      }
    } finally {
      lock.current = false;
      setPhase(undefined);
    }
  }

  const unavailable = disabled || Boolean(phase);
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="nv-button-secondary relative cursor-pointer focus-within:outline-2 focus-within:outline-primary has-disabled:cursor-not-allowed has-disabled:opacity-60">
        <Upload size={14} aria-hidden="true"/>{file ? 'Trocar arquivo' : replace ? 'Selecionar nova versão' : 'Selecionar arquivo'}
        <input ref={input} type="file" className="sr-only" aria-label={`Selecionar arquivo de ${name} em PDF, JPEG, PNG ou WebP`}
          accept={medicalFileAccept} disabled={unavailable} onChange={event => { setFile(event.target.files?.[0]); setPreserve(false); }}/>
      </label>
      {file && <button type="button" className="nv-button" disabled={unavailable} onClick={() => void upload()}>{replace ? 'Enviar nova versão' : 'Enviar arquivo'}</button>}
    </div>
    {file && <p className="break-all text-xs text-text-muted">{file.name}</p>}
    {file && /^image\/(jpeg|png)$/.test(file.type) && <label className="inline-flex min-h-9 items-center gap-2 text-xs text-text-secondary">
      <input type="checkbox" checked={preserve} disabled={unavailable} onChange={event => setPreserve(event.target.checked)}/>
      Manter arquivo original
    </label>}
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-text-secondary">
      {phase && <><LoaderCircle size={15} className="shrink-0 motion-safe:animate-spin" aria-hidden="true"/>{phase}</>}
    </div>
  </div>;
}
