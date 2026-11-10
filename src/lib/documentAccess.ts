function isExactMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[0] === value;
}

export function isMedicalDocumentPath(path: string, organization: string, doctor: string) {
  const [orgSegment, doctorSegment, file, extra] = path.split('/');
  return extra === undefined && orgSegment === organization && doctorSegment === doctor
    && isExactMatch(orgSegment, /^[A-Za-z0-9_-]+$/)
    && isExactMatch(doctorSegment, /^[A-Za-z0-9_-]+$/)
    && Boolean(file && isExactMatch(file, /^[A-Za-z0-9_-]+\.(pdf|jpe?g|png)$/));
}

export async function readBoundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    reader.releaseLock();
  }
}
