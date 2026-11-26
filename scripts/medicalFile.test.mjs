import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, PDFName } from 'pdf-lib';
import { medicalFileExtension, maxMedicalFileBytes, medicalRasterInfo, normalizeMedicalFilename } from '../src/lib/medicalFile.ts';
import { validateMedicalImage } from '../src/lib/medicalImageValidation.ts';
import { inspectPreservedPdf, optimizeLegacyImage } from './medical-storage-media.mjs';

test('identifies file content along with extension and MIME', async () => {
  const pdf = new File(['%PDF-1.7\n%%EOF\n'], 'crm.pdf', { type: 'application/pdf' });
  assert.equal(await medicalFileExtension(pdf), 'pdf');
  const jpeg = new File([Uint8Array.from([255, 216, 255, 1, 255, 217])], 'crm.jpeg', { type: 'image/jpeg' });
  assert.equal(await medicalFileExtension(jpeg), 'jpg');
  const png = new File([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,73,69,78,68,174,66,96,130])], 'crm.png', { type: 'image/png' });
  assert.equal(await medicalFileExtension(png), 'png');
});

test('rejects disguised, truncated and oversized uploads', async () => {
  assert.equal(await medicalFileExtension(new File(['<html>test</html>'], 'fake.pdf', { type: 'application/pdf' })), null);
  assert.equal(await medicalFileExtension(new File(['%PDF-1.7'], 'broken.pdf', { type: 'application/pdf' })), null);
  assert.equal(await medicalFileExtension(new File(['%PDF-1.7\n%%EOF'], 'file.jpg', { type: 'application/pdf' })), null);
  assert.equal(await medicalFileExtension(new File([new Uint8Array(maxMedicalFileBytes + 1)], 'big.png', { type: 'image/png' })), null);
});

const filename = (kind, bytes) => new File([bytes], `sintetico.${kind}`, { type: `image/${kind === 'jpg' ? 'jpeg' : kind}` });

test('decodes actual WebP, screens dimensions and retains existing files', async () => {
  const webp = await sharp({ create: { width: 60, height: 45, channels: 4, background: '#ff002280' } }).webp().toBuffer();
  assert.equal(await medicalFileExtension(filename('webp', webp)), 'webp');
  assert.equal(await validateMedicalImage(filename('webp', webp), 'webp'), true);
  const truncated = webp.subarray(0, 32);
  assert.equal(await medicalFileExtension(filename('webp', truncated)), null);
  assert.equal(await validateMedicalImage(filename('webp', truncated), 'webp'), false);
  assert.equal(await validateMedicalImage(filename('png', webp), 'png'), false);
  const largePng = await sharp({ create: { width: 5_000, height: 5_000, channels: 3, background: 'pink' } }).png().toBuffer();
  assert.equal(medicalRasterInfo(largePng, 'png'), null);
  assert.equal(await validateMedicalImage(filename('png', largePng), 'png'), false);
  assert.equal(normalizeMedicalFilename('../../CRMº\u202E.png', 'webp'), '_.._CRMº_.webp');
});

test('local trials retain EXIF orientation and pixels for lossless transparent PNG', async () => {
  const design = Buffer.from('<svg width="1000" height="600"><rect width="1000" height="600" fill="white"/><text x="60" y="90" font-size="14">CRM 00000 RQE 0000</text><rect x="12" y="221" width="323" height="34" fill="black"/></svg>');
  const jpegBase = await sharp(design).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
  const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');
  for (const orientation of [2, 3, 6, 8]) {
    exif.writeUInt16LE(orientation, 28);
    const jpeg = Buffer.concat([jpegBase.subarray(0, 2), exif, jpegBase.subarray(2)]);
    const optimized = await optimizeLegacyImage(jpeg, 'jpg');
    assert.ok(optimized && optimized.length < jpeg.length);
    const metadata = await sharp(optimized).metadata();
    assert.deepEqual([metadata.width, metadata.height], orientation >= 5 ? [600, 1000] : [1000, 600]);
    assert.equal(metadata.orientation, undefined);
  }

  const translucent = await sharp({ create: { width: 400, height: 200, channels: 4, background: '#00237680' } }).png({ compressionLevel: 0 }).toBuffer();
  const output = await optimizeLegacyImage(translucent, 'png');
  assert.ok(output && output.length < translucent.length);
  assert.deepEqual(await sharp(output).raw().toBuffer(), await sharp(translucent).raw().toBuffer());

  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).webp().toBuffer();
  assert.equal(await optimizeLegacyImage(tiny, 'png'), null);
  const highResolution = await sharp({ create: { width: 2900, height: 600, channels: 3, background: 'white' } }).jpeg().toBuffer();
  assert.equal(await optimizeLegacyImage(highResolution, 'jpg'), null);
  assert.equal(await validateMedicalImage(filename('jpg', highResolution), 'jpg'), true);
});

test('keeps a compact original when the WebP would grow', async () => {
  const pixels = Buffer.alloc(32 * 32 * 3);
  let state = 57423;
  for (let index = 0; index < pixels.length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    pixels[index] = state >>> 24;
  }
  const original = await sharp(pixels, { raw: { width: 32, height: 32, channels: 3 } }).jpeg({ quality: 5 }).toBuffer();
  assert.ok((await sharp(original).webp({ quality: 90 }).toBuffer()).length > original.length);
  assert.equal(await optimizeLegacyImage(original, 'jpg'), null);
});

test('preserves searchable, raster, multipage and signature-marked PDFs byte for byte', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('CRM 0000');
  const raster = await sharp({ create: { width: 50, height: 50, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const scanned = await pdf.embedJpg(raster);
  pdf.addPage().drawImage(scanned, { width: 50, height: 50 });
  const original = Buffer.from(await pdf.save());
  assert.equal(await inspectPreservedPdf(original), 'no-visible-marker');
  assert.equal((await PDFDocument.load(original)).getPageCount(), 2);
  const file = new File([original], 'digitalizado.pdf', { type: 'application/pdf' });
  assert.equal(await medicalFileExtension(file), 'pdf');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), original);

  const dictionary = pdf.context.obj({ Type: 'Sig', ByteRange: [0, 10, 20, 30] });
  pdf.catalog.set(PDFName.of('Perms'), pdf.context.obj({ DocMDP: pdf.context.register(dictionary) }));
  const signed = Buffer.from(await pdf.save({ useObjectStreams: false }));
  assert.equal(await inspectPreservedPdf(signed), 'signature-marker');
  assert.equal(await medicalFileExtension(new File([signed], 'assinado.pdf', { type: 'application/pdf' })), 'pdf');
});
