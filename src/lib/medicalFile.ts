const formats = {
  'application/pdf': { extension: 'pdf', filename: /\.pdf$/i, header: [37, 80, 68, 70, 45] },
  'image/jpeg': { extension: 'jpg', filename: /\.jpe?g$/i, header: [255, 216, 255] },
  'image/png': { extension: 'png', filename: /\.png$/i, header: [137, 80, 78, 71, 13, 10, 26, 10] },
} as const;

export const maxMedicalFileBytes = 4_000_000;

export async function medicalFileExtension(file: File) {
  if (file.size === 0 || file.size > maxMedicalFileBytes || !Object.hasOwn(formats, file.type)) return null;
  const format = formats[file.type as keyof typeof formats];
  if (!format.filename.test(file.name)) return null;
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!format.header.every((byte, index) => header[index] === byte)) return null;

  const tail = new Uint8Array(await file.slice(-1024).arrayBuffer());
  if (format.extension === 'pdf') {
    return /%%EOF\s*$/.test(new TextDecoder().decode(tail)) ? 'pdf' : null;
  }
  const trailer = format.extension === 'png' ? [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130] : [255, 217];
  return trailer.every((byte, index) => tail[tail.length - trailer.length + index] === byte) ? format.extension : null;
}
