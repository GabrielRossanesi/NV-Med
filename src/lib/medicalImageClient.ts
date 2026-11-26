import { medicalImagePolicy } from './medicalFile';

export function optimizeInWorker(file: File, kind: 'jpg' | 'png') {
  return new Promise<Blob | null>((resolve) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./medicalImage.worker.ts', import.meta.url)); }
    catch { resolve(null); return; }
    const finish = (blob: Blob | null) => {
      window.clearTimeout(timeout);
      worker.terminate();
      resolve(blob);
    };
    const timeout = window.setTimeout(() => finish(null), medicalImagePolicy.browserTimeoutMs);
    worker.onmessage = event => finish(event.data instanceof Blob ? event.data : null);
    worker.onerror = () => finish(null);
    worker.onmessageerror = () => finish(null);
    try { worker.postMessage({ file, kind }); }
    catch { finish(null); }
  });
}
