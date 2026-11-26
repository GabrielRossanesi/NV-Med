import sharp from 'sharp';

export const maxAvatarBytes = 5 * 1024 * 1024;
export const maxAvatarRequestBytes = maxAvatarBytes + 12_000;

const avatarFormats = {
  'image/jpeg': { format: 'jpeg', extension: 'jpg' },
  'image/png': { format: 'png', extension: 'png' },
  'image/webp': { format: 'webp', extension: 'webp' },
} as const;

export async function decodeAvatar(file: File) {
  if (!file.size || file.size > maxAvatarBytes || !Object.hasOwn(avatarFormats, file.type)) return null;
  const { format, extension } = avatarFormats[file.type as keyof typeof avatarFormats];
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 24_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) return null;
    const buffer = await image.autoOrient().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).toFormat(format).toBuffer();
    if (buffer.length > maxAvatarBytes) return null;
    return { body: new Uint8Array(buffer), extension, contentType: file.type };
  } catch {
    return null;
  }
}
