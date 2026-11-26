import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { medicalFileExtension, medicalImagePolicy, medicalRasterInfo, pdfProtectionIndicators } from '../src/lib/medicalFile.ts';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function optimizeLegacyImage(bytes, kind) {
  const file = new File([bytes], `arquivo.${kind}`, { type: kind === 'jpg' ? 'image/jpeg' : 'image/png' });
  if (await medicalFileExtension(file, medicalImagePolicy.maxSourceBytes) !== kind) return null;
  const shape = medicalRasterInfo(bytes, kind);
  if (!shape || shape.preserve || Math.max(shape.width, shape.height) > medicalImagePolicy.maxOptimizationSide) return null;
  const source = sharp(bytes, { limitInputPixels: medicalImagePolicy.maxImagePixels, failOn: 'warning' }).timeout({ seconds: 5 });
  const metadata = await source.metadata();
  if (metadata.pages > 1 || metadata.icc || metadata.xmp || metadata.iptc) return null;
  const output = await source.autoOrient().webp({ lossless: kind === 'png', quality: Math.round(medicalImagePolicy.quality * 100) }).toBuffer();
  if (output.length >= bytes.length) return null;
  const details = await sharp(output).metadata();
  const rotate = [5, 6, 7, 8].includes(metadata.orientation);
  if (details.format !== 'webp' || details.width !== (rotate ? shape.height : shape.width)
    || details.height !== (rotate ? shape.width : shape.height) || Boolean(metadata.hasAlpha) !== Boolean(details.hasAlpha)) return null;
  return output;
}

export async function inspectPreservedPdf(bytes) {
  const pdf = new File([bytes], 'arquivo.pdf', { type: 'application/pdf' });
  if (!await medicalFileExtension(pdf, 10_000_000)) return 'unclassified';
  const indicators = pdfProtectionIndicators(bytes);
  if (indicators.signature && indicators.encrypted) return 'signature-and-encryption-markers';
  if (indicators.signature) return 'signature-marker';
  if (indicators.encrypted) return 'encryption-marker';
  return 'no-visible-marker';
}

export function storageCandidateId(name) {
  return digest(name);
}
