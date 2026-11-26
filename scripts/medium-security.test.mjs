import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { decodeAvatar, maxAvatarBytes } from '../src/lib/avatarFile.ts';
import { scanMedicalDocuments } from './scan-medical-documents.mjs';

test('avatar decoding checks bytes against MIME and normalizes supported images', async () => {
  const image = sharp({ create: { width: 1800, height: 300, channels: 3, background: 'navy' } });
  for (const format of ['jpeg', 'png', 'webp']) {
    const original = await image.clone().toFormat(format).toBuffer();
    const result = await decodeAvatar(new File([original], `original.${format}`, { type: `image/${format}` }));
    assert.ok(result);
    const metadata = await sharp(result.body).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 1024);
    const wrongType = format === 'png' ? 'image/jpeg' : 'image/png';
    assert.equal(await decodeAvatar(new File([original], 'original', { type: wrongType })), null);
  }
  assert.equal(await decodeAvatar(new File(['not an image'], 'test.png', { type: 'image/png' })), null);
  assert.equal(await decodeAvatar(new File([new Uint8Array(maxAvatarBytes + 1)], 'too-large.png', { type: 'image/png' })), null);
});

test('the scanner records a failure and preserves quarantine when an object cannot be read', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === 'nv_claim_medical_scan' ? { path: 'tenant/doctor/test.pdf', claim_id: 'synthetic' } : true };
    },
    storage: { from: () => ({ download: async () => ({ error: { message: 'simulated interruption' } }) }) },
  };
  const totals = await scanMedicalDocuments(client, () => assert.fail('unreadable object reached the scanner'), 50);
  assert.deepEqual(totals, { clean: 0, blocked: 0, failed: 1, interrupted: 0 });
  assert.deepEqual(calls, [
    { name: 'nv_claim_medical_scan', args: undefined },
    { name: 'nv_finish_medical_scan', args: { claim: 'synthetic', verdict: 'failed' } },
  ]);
});
