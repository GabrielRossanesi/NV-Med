export type CsvValue = string | number | boolean | null | undefined;

function safeCell(value: CsvValue) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^(?:[\t\r\n]|\s*[=+\-@])/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: CsvValue[][]) {
  return `\uFEFF${[headers, ...rows].map(row => row.map(safeCell).join(';')).join('\r\n')}`;
}

export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]) {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(filename.endsWith('.csv') ? filename : `${filename}.csv`, blob);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
