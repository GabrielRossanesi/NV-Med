'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatStorageBytes } from '@/lib/storageUsage';

type Breakdown = { dimension: 'bucket' | 'company' | 'format'; key: string; label: string; bytes: number; files: number };
type Snapshot = {
  used_bytes: number; limit_bytes: number; files: number; unknown_sizes: number;
  confirmed_savings: number; reported_savings: number; refreshed_at: string;
  level: 0 | 1 | 2 | 3 | 4; breakdown: Breakdown[];
};

const levels = [
  { label: 'Normal', text: 'text-success', fill: 'bg-success' },
  { label: 'Atenção', text: 'text-warning', fill: 'bg-warning' },
  { label: 'Alerta', text: 'text-warning', fill: 'bg-warning' },
  { label: 'Crítico', text: 'text-danger', fill: 'bg-danger' },
  { label: 'Limite atingido', text: 'text-danger', fill: 'bg-danger' },
];
const dimensions = { bucket: 'Bucket', format: 'Formato', company: 'Empresa' } as const;

async function loadUsage(refresh = false): Promise<Snapshot> {
  const result = await createClient()?.rpc('nv_storage_usage', { refresh });
  if (!result || result.error || !result.data) throw new Error();
  return result.data;
}

export default function StorageUsagePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [dimension, setDimension] = useState<keyof typeof dimensions>('bucket');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void loadUsage().then(data => { if (active) setSnapshot(data); }, () => { if (active) setError(true); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    setBusy(true);
    setError(false);
    try { setSnapshot(await loadUsage(true)); }
    catch { setError(true); }
    finally { setBusy(false); }
  }

  const percent = snapshot ? snapshot.used_bytes / snapshot.limit_bytes * 100 : 0;
  const level = snapshot ? levels[snapshot.level] : levels[0];
  const available = snapshot ? Math.max(0, snapshot.limit_bytes - snapshot.used_bytes) : 0;
  const breakdown = snapshot?.breakdown.filter(row => row.dimension === dimension) ?? [];
  const number = new Intl.NumberFormat('pt-BR');

  return <section id="armazenamento" aria-labelledby="storage-title" className="nv-panel space-y-4 p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="storage-title" className="nv-section-title">Armazenamento</h2>
      <button type="button" className="nv-button-secondary" onClick={() => void refresh()} disabled={busy}>
        <RefreshCw size={15} aria-hidden="true" className={busy ? 'motion-safe:animate-spin' : undefined}/>{busy ? 'Atualizando…' : 'Atualizar'}</button>
    </header>
    {error && <p role="alert" className="text-sm text-danger">Não foi possível atualizar o armazenamento.</p>}
    {!snapshot && busy && <p role="status" className="text-sm text-text-muted">Consultando o uso do armazenamento…</p>}
    {snapshot && <>
      <div className="space-y-2" role="status">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums">{formatStorageBytes(snapshot.used_bytes)} <span className="text-sm font-normal text-text-muted">de {formatStorageBytes(snapshot.limit_bytes)}</span></p>
          <p className={`text-sm font-semibold ${level.text}`}>{level.label}</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Ocupação do armazenamento" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(percent))} aria-valuetext={`${percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% em uso`}>
          <div className={`h-full rounded-full ${level.fill}`} style={{ width: `${Math.min(100, percent)}%` }}/>
        </div>
        <p className="text-sm text-text-secondary">{percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% em uso. {formatStorageBytes(available)} disponíveis.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-y border-border py-3 sm:grid-cols-3">
        <div><dt className="text-xs text-text-muted">Arquivos</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{number.format(snapshot.files)}</dd></div>
        <div><dt className="text-xs text-text-muted">Economia confirmada no acervo</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{formatStorageBytes(snapshot.confirmed_savings)}</dd></div>
        <div><dt className="text-xs text-text-muted">Economia estimada nos envios</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{formatStorageBytes(snapshot.reported_savings)}</dd></div>
      </dl>
      <div className="space-y-2">
        <label className="nv-label w-fit">Agrupar consumo por
          <select className="nv-input" value={dimension} onChange={event => setDimension(event.target.value as keyof typeof dimensions)}>
            {Object.entries(dimensions).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        {breakdown.length > 0 ? <div className="max-h-72 overflow-auto" tabIndex={0} role="region" aria-label={`Consumo por ${dimensions[dimension].toLowerCase()}`}>
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-border text-text-muted"><th scope="col" className="py-2 pr-2">{dimensions[dimension]}</th>
              <th scope="col" className="py-2 pr-2 text-right">Arquivos</th><th scope="col" className="py-2 text-right">Consumo</th></tr></thead>
            <tbody className="divide-y divide-border">{breakdown.map(row => <tr key={row.key}>
              <th scope="row" className="break-all py-2 pr-2 font-medium">{row.label}</th>
              <td className="py-2 pr-2 text-right tabular-nums">{number.format(row.files)}</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{formatStorageBytes(row.bytes)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="text-sm text-text-muted">Nenhum arquivo neste agrupamento.</p>}
      </div>
      <p className="text-xs text-text-muted">Estimativa do catálogo do Supabase Storage. Atualizado em <time dateTime={snapshot.refreshed_at}>{new Date(snapshot.refreshed_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time>.
        {snapshot.unknown_sizes > 0 && ` ${number.format(snapshot.unknown_sizes)} arquivos com tamanho indisponível.`}</p>
    </>}
  </section>;
}
