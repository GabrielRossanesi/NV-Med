import writeExcelFile, { type Cell } from 'write-excel-file/node';
import { toCsv } from './csv.ts';
import { directoryDocumentLabel, directoryPortalLabels, directoryStatusLabels, type DirectoryDoctor } from './doctorDirectory.ts';

const headers = ['Nome completo', 'CRM', 'UF', 'RQEs', 'Especialidades', 'Contratação', 'Contrato', 'Unidades atendidas', 'Status cadastral', 'Documentação', 'Portal Médico'];
export function doctorExportRows(doctors: DirectoryDoctor[]) {
  return doctors.map(doctor => [doctor.name, doctor.crm, doctor.crmUf,
    doctor.rqes.map(rqe => `${rqe.number} (${rqe.specialty || 'sem vínculo identificado'})`).join('; '),
    doctor.specialties.join('; '), doctor.contractModel.toUpperCase(), doctor.contractSigned ? 'Assinado' : 'Pendente',
    doctor.units.map(unit => unit.name).join('; '), directoryStatusLabels[doctor.status], directoryDocumentLabel(doctor.documents),
    doctor.portalStatus ? directoryPortalLabels[doctor.portalStatus] : 'Sem permissão']);
}
export function doctorDirectoryCsv(doctors: DirectoryDoctor[]) { return toCsv(headers, doctorExportRows(doctors)); }
export function doctorDirectoryWorkbook(doctors: DirectoryDoctor[]) {
  return writeExcelFile([{ sheet: 'Médicos', stickyRowsCount: 1, columns: headers.map((_, index) => ({ width: index === 0 ? 40 : 26 })),
    data: [headers.map(value => ({ type: String, value, fontWeight: 'bold' } as Cell)),
      ...doctorExportRows(doctors).map(row => row.map(value => ({ type: String, value } as Cell)))],
  }]).toBuffer();
}
