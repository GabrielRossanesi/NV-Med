const formats = {
  'application/pdf': { extension: 'pdf', filename: /\.pdf$/i, header: [37, 80, 68, 70, 45] },
  'image/jpeg': { extension: 'jpg', filename: /\.jpe?g$/i, header: [255, 216, 255] },
  'image/png': { extension: 'png', filename: /\.png$/i, header: [137, 80, 78, 71, 13, 10, 26, 10] },
  'image/webp': { extension: 'webp', filename: /\.webp$/i, header: [82, 73, 70, 70] },
} as const;

export const maxMedicalFileBytes = 4_000_000;
export const medicalFileAccept = '.pdf,.jpg,.jpeg,.png,.webp';
export const medicalImagePolicy = {
  version: 'webp-v1', quality: 0.9, maxOptimizationSide: 2560,
  maxImageSide: 8192, maxImagePixels: 24_000_000, maxBrowserPixels: 12_000_000,
  maxSourceBytes: 12_000_000, browserTimeoutMs: 8_000,
};

export async function medicalFileExtension(file: File, limit = maxMedicalFileBytes) {
  if (file.size === 0 || file.size > limit || !Object.hasOwn(formats, file.type)) return null;
  const format = formats[file.type as keyof typeof formats];
  if (!format.filename.test(file.name)) return null;
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!format.header.every((byte, index) => header[index] === byte)) return null;
  if (format.extension === 'webp') {
    const bytes = await file.slice(0, 16).arrayBuffer();
    const tag = new TextDecoder().decode(bytes.slice(8, 16));
    return file.size >= 20 && /^WEBPVP8[ LX]$/.test(tag)
      && new DataView(bytes).getUint32(4, true) + 8 === file.size ? 'webp' : null;
  }

  const tail = new Uint8Array(await file.slice(-1024).arrayBuffer());
  if (format.extension === 'pdf') {
    return /%%EOF\s*$/.test(new TextDecoder().decode(tail)) ? 'pdf' : null;
  }
  const trailer = format.extension === 'png' ? [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130] : [255, 217];
  return trailer.every((byte, index) => tail[tail.length - trailer.length + index] === byte) ? format.extension : null;
}

export function normalizeMedicalFilename(name: string, extension: string) {
  const stem = name.normalize('NFC').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _.-]/gu, '_')
    .replace(/^[. ]+|[. ]+$/g, '').slice(0, 180);
  return `${stem || 'documento'}.${extension}`;
}

export function allowedMedicalImageSize(width: number, height: number) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && Math.max(width, height) <= medicalImagePolicy.maxImageSide && width * height <= medicalImagePolicy.maxImagePixels;
}

export function pdfProtectionIndicators(bytes: Uint8Array) {
  const text = new TextDecoder('windows-1252').decode(bytes);
  return {
    signature: /\/ByteRange\s*\[|\/DocMDP\b|\/FieldMDP\b|\/ETSI\.CAdES\.detached\b|\/adbe\.pkcs7\./.test(text),
    encrypted: /\/Encrypt\s+\d+\s+\d+\s+R/.test(text),
  };
}

// Bounds from the container, before allocating a decoded bitmap. The decoder validates the pixels.
export function medicalRasterInfo(bytes: Uint8Array, kind: 'jpg' | 'png') {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('windows-1252');
  const integrity = /c2pa|content credentials|jumbf|xml.?signature|digitalsignature|adobe:ns:meta/i;
  let width = 0;
  let height = 0;
  let preserve = false;
  if (kind === 'png') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = data.getUint32(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) return null;
      const chunk = decoder.decode(bytes.subarray(offset + 4, offset + 8));
      if (offset === 8) {
        if (chunk !== 'IHDR' || length !== 13) return null;
        width = data.getUint32(offset + 8);
        height = data.getUint32(offset + 12);
        preserve ||= bytes[offset + 16] === 16; // Canvas reduces channel precision.
      } else if (chunk === 'IHDR') return null;
      if (['acTL', 'caBX', 'iCCP'].includes(chunk)) preserve = true;
      if (['eXIf', 'iTXt', 'tEXt', 'zTXt'].includes(chunk)) preserve = true;
      if (chunk === 'IEND') return end === bytes.length && allowedMedicalImageSize(width, height) ? { width, height, preserve } : null;
      offset = end;
    }
    return null;
  }

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) return allowedMedicalImageSize(width, height) ? { width, height, preserve } : null;
    if (offset + 2 > bytes.length) return null;
    const length = data.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || width || height) return null;
      height = data.getUint16(offset + 3);
      width = data.getUint16(offset + 5);
      preserve ||= bytes[offset + 2] !== 8 || bytes[offset + 7] === 4;
    }
    if (marker === 0xeb || marker === 0xed || marker === 0xe2) preserve = true;
    if (marker >= 0xe1 && marker <= 0xef && integrity.test(decoder.decode(bytes.subarray(offset + 2, offset + length)))) preserve = true;
    offset += length;
  }
  return null;
}
