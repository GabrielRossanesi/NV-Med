import sharp from 'sharp';
import { allowedMedicalImageSize, medicalImagePolicy } from './medicalFile.ts';

export async function validateMedicalImage(file: File, kind: 'jpg' | 'png' | 'webp') {
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: medicalImagePolicy.maxImagePixels, failOn: 'warning', sequentialRead: true,
    }).timeout({ seconds: 4 });
    const details = await image.metadata();
    if (details.format !== (kind === 'jpg' ? 'jpeg' : kind) || (details.pages ?? 1) > 1
      || !allowedMedicalImageSize(details.width, details.height)) return false;
    await image.resize(1, 1, { fastShrinkOnLoad: false }).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}
