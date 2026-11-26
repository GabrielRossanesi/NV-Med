import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { activeDirectoryFilters, defaultDoctorListing, directoryParams, emptyDirectoryFilters, parseDirectoryQuery } from '../src/lib/doctorDirectory.ts';
import { doctorDirectoryCsv, doctorDirectoryWorkbook, doctorExportRows } from '../src/lib/doctorDirectoryExport.ts';

test('directory query preserves combined filters and page through a profile round-trip', () => {
  const query = { filters: { ...emptyDirectoryFilters, q: 'João & Maria', rqe: 'without', specialty: 'Clínica Geral', documents: 'near', unit: 'unit-1' }, page: 3, pageSize: 50, sort: 'crm', descending: true };
  assert.deepEqual(parseDirectoryQuery(directoryParams(query, 'company-1')), query);
  assert.deepEqual(activeDirectoryFilters(query.filters), ['q','specialty','rqe','unit','documents']);
});
test('directory query uses account preferences and bounds invalid URL parameters', () => {
  const preferences = { ...defaultDoctorListing, pageSize: 100, sort: 'specialty', descending: true };
  assert.deepEqual(parseDirectoryQuery(new URLSearchParams(), preferences), { filters: emptyDirectoryFilters, page: 1, pageSize: 100, sort: 'specialty', descending: true });
  const query = parseDirectoryQuery(new URLSearchParams('page=-3&pageSize=5000&sort=sql&status=bad&rqe=validated&q='+'x'.repeat(200)));
  assert.equal(query.page, 1); assert.equal(query.pageSize,25); assert.equal(query.sort,'name'); assert.equal(query.filters.status,'all'); assert.equal(query.filters.rqe,'all'); assert.equal(query.filters.q.length,150);
});
test('existing specialty, unit and documentation links remain usable', () => {
  const query = parseDirectoryQuery(new URLSearchParams('especialidade=Cirurgia&unitId=unit-2&documentStatus=compliant'));
  assert.equal(query.filters.specialty,'Cirurgia'); assert.equal(query.filters.unit,'unit-2'); assert.equal(query.filters.documents,'complete');
});
const doctor = { id:'test',name:'=HYPERLINK("https://example.invalid")',crm:'00123',crmUf:'SP',rqes:[{number:'00123',specialty:null,legacy:true},{number:'456',specialty:'Cirurgia',legacy:false}],specialties:['Cirurgia','Clínica Geral'],contractModel:'pf',contractSigned:false,units:[{name:'Unidade fictícia'}],status:'active',documents:{pending:1,expired:1,near:0,missing:0,complete:false},portalStatus:'not_released',cpf:'MUST_NOT_EXPORT',email:'private@example.invalid',address:'private',phone:'private',bank:'private' };
test('professional CSV exports keep CRM zeros and protect formulas without exporting private fields', () => {
  const csv = doctorDirectoryCsv([doctor]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('00123'));
  assert.ok(csv.includes('sem vínculo identificado')); assert.ok(csv.includes('Não liberado'));
  for (const privateValue of ['MUST_NOT_EXPORT','private@example.invalid','"CPF"','"Banco"']) assert.ok(!csv.includes(privateValue));
  assert.equal(doctorExportRows([doctor])[0].length,11);
});
test('XLSX exports use text cells for untrusted values and produce a real workbook', async () => {
  const buffer = await doctorDirectoryWorkbook([doctor]);
  assert.equal(buffer.subarray(0,2).toString(),'PK'); assert.ok(buffer.length>1000);
  const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  let offset=buffer.readUInt32LE(end+16);const entries={};
  for(let i=0;i<buffer.readUInt16LE(end+10);i++){
    const method=buffer.readUInt16LE(offset+10),size=buffer.readUInt32LE(offset+20),nameLength=buffer.readUInt16LE(offset+28),extraLength=buffer.readUInt16LE(offset+30),commentLength=buffer.readUInt16LE(offset+32),local=buffer.readUInt32LE(offset+42);
    const name=buffer.subarray(offset+46,offset+46+nameLength).toString();const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
    const compressed=buffer.subarray(start,start+size);entries[name]=(method===8?inflateRawSync(compressed):compressed).toString();
    offset+=46+nameLength+extraLength+commentLength;
  }
  assert.ok(!/<f[ >]/.test(entries['xl/worksheets/sheet1.xml']));
  assert.ok(entries['xl/sharedStrings.xml'].includes('HYPERLINK'));
});
