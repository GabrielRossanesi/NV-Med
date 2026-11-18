import test from 'node:test';
import assert from 'node:assert/strict';
import { isMedicalDocumentPath, medicalDocumentPreviewKind } from '../src/lib/documentAccess.ts';

test('existing private doctor paths support preserved original document formats', () => {
  for (const extension of ['pdf','jpg','jpeg','png','doc','docx','heif','pages','mht']) {
    assert.equal(isMedicalDocumentPath(`tenant/doctor/original.${extension}`, 'tenant', 'doctor'), true);
  }
  for (const path of ['tenant/other/original.docx','other/doctor/original.doc','tenant/doctor/../original.docx',
    'tenant/doctor/original.docx.exe','tenant/doctor/original.html','tenant/doctor/original.svg','tenant/doctor/original.docx?token=x']) {
    assert.equal(isMedicalDocumentPath(path,'tenant','doctor'),false);
  }
});

test('browser previews render PDF/images and download other originals as attachments', () => {
  assert.equal(medicalDocumentPreviewKind('tenant/doctor/file.pdf'),'pdf');
  assert.equal(medicalDocumentPreviewKind('tenant/doctor/file.png'),'image');
  assert.equal(medicalDocumentPreviewKind('tenant/doctor/file.jpg'),'image');
  for (const extension of ['doc','docx','heif','pages','html']) {
    assert.equal(medicalDocumentPreviewKind(`tenant/doctor/file.${extension}`),'download');
  }
});
