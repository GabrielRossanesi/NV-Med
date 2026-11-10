import test from 'node:test';
import assert from 'node:assert/strict';
import { medicalFileExtension, maxMedicalFileBytes } from '../src/lib/medicalFile.ts';

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
