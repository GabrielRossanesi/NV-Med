'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import { canViewPermission } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/client';
import { financeStateLabels, saoPauloDate } from '@/lib/financeState';
import { presenceReportStates, shiftReportStates, type ShiftReport } from '@/lib/shiftReport';
import { useStore } from '@/store/useStore';

type Preview = ShiftReport & { total: number };
function Options({ values }: { values: Record<string, string> }) {
  return <><option value="">Todos</option>{Object.entries(values).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>;
}

function Report({ initial, activeOrganization }: { initial: Record<string, string>; activeOrganization: string }) {
  const store = useStore();
  const today = saoPauloDate();
  const [company, setCompany] = useState(initial.empresa || activeOrganization);
  const [unit, setUnit] = useState(initial.unidade || '');
  const [coordinatorOrg, setCoordinatorOrg] = useState('');
  const [report, setReport] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState(() => {
    const query = new URLSearchParams({ empresa: company, inicio: initial.inicio || today.slice(0, 7) + '-01', fim: initial.fim || today });
    for (const key of ['unidade','especialidade','posto','medico','situacao','presenca','pagamento']) {
      if (initial[key]) query.set(key, initial[key]);
    }
    return query.toString();
  });
  useEffect(() => {
    let active = true;
    const client = createClient();
    if (client && company) void client.rpc('nv_coordinator', { org: company }).then(result => {
      if (active && result.data === true) setCoordinatorOrg(company);
    });
    return () => { active = false; };
  }, [company]);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/reports/shifts?' + filters, { signal: abort.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Não foi possível abrir o relatório.');
        setReport(data);
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível abrir o relatório.');
      }
    })();
    return () => abort.abort();
  }, [filters]);

  async function download(format: 'csv' | 'xlsx') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/reports/shifts?' + filters + '&format=' + format);
      if (!response.ok) throw new Error((await response.json()).error || 'Não foi possível exportar.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'nvmed-plantoes.' + format;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível exportar.');
    } finally {
      setBusy(false);
    }
  }

  const units = store.units.filter(item => item.organizationId === company);
  const sectors = store.sectors.filter(item => item.organizationId === company && (!unit || item.unitId === unit));
  const doctors = store.doctors.filter(item => item.organizationId === company);
  const specialties = [...new Set(sectors.flatMap(item => item.specialties))].sort();
  return <div className="space-y-5">
    <header>
      <Link href="/relatorios" className="text-sm font-semibold text-primary underline">Voltar aos relatórios</Link>
      <h1 className="nv-page-title mt-2 flex items-center gap-2"><FileSpreadsheet size={24} className="text-primary"/>Relatório de plantões</h1>
    </header>
    <form className="space-y-4 rounded-xl border border-border bg-card-bg p-4" onSubmit={event => {
      event.preventDefault();
      const query = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value) query.set(key, value);
      setError('');
      if (query.toString() !== filters) {
        setReport(null);
        setFilters(query.toString());
      }
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="nv-label">Empresa<select className="nv-input" name="empresa" required value={company} onChange={event => {
          setCompany(event.target.value); setUnit(''); setCoordinatorOrg('');
        }}>{store.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="nv-label">Início<input type="date" className="nv-input" name="inicio" defaultValue={initial.inicio || today.slice(0, 7) + '-01'} required/></label>
        <label className="nv-label">Fim<input type="date" className="nv-input" name="fim" defaultValue={initial.fim || today} required/></label>
        <label className="nv-label">Unidade<select className="nv-input" name="unidade" value={unit} onChange={event => setUnit(event.target.value)}>
          <Options values={Object.fromEntries(units.map(item => [item.id, item.name]))}/></select></label>
        <label className="nv-label">Posto<select key={company + unit} className="nv-input" name="posto" defaultValue={initial.posto || ''}>
          <Options values={Object.fromEntries(sectors.map(item => [item.id, item.name]))}/></select></label>
        <label className="nv-label">Especialidade<select key={company + unit} className="nv-input" name="especialidade" defaultValue={initial.especialidade || ''}>
          <Options values={Object.fromEntries(specialties.map(item => [item, item]))}/></select></label>
        <label className="nv-label">Médico<select key={company} className="nv-input" name="medico" defaultValue={initial.medico || ''}>
          <Options values={Object.fromEntries(doctors.map(item => [item.id, item.name]))}/></select></label>
        <label className="nv-label">Situação do plantão<select className="nv-input" name="situacao" defaultValue={initial.situacao || ''}><Options values={{ active: 'Ativos', ...shiftReportStates }}/></select></label>
        {coordinatorOrg === company && <label className="nv-label">Presença<select className="nv-input" name="presenca" defaultValue={initial.presenca || ''}><Options values={presenceReportStates}/></select></label>}
        {canViewPermission(store.currentUser, 'financeiro') && <label className="nv-label">Situação financeira<select className="nv-input" name="pagamento" defaultValue={initial.pagamento || ''}>
          <Options values={{ unpaid: 'Aguardando pagamento', ...financeStateLabels }}/></select></label>}
      </div>
      <button className="nv-button">Aplicar filtros</button>
    </form>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!report && !error && <p role="status" className="text-sm text-text-muted">Carregando plantões…</p>}
    {report && <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{report.total} {report.total === 1 ? 'plantão encontrado' : 'plantões encontrados'}{report.total > 100 && ' · Prévia dos primeiros 100'}</p>
        <div className="flex gap-2">{(['csv','xlsx'] as const).map(format => <button type="button" className="nv-button-secondary" disabled={busy || !report.total} onClick={() => void download(format)} key={format}>
          <Download size={15}/>Exportar {format.toUpperCase()}
        </button>)}</div>
      </div>
      {report.rows.length > 0 && <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[660px] text-left text-sm">
          <thead className="bg-surface-muted"><tr>{['Data','Unidade e posto','Médico','Situação', ...(report.attendance ? ['Presença'] : []), ...(report.finance ? ['Pagamento'] : [])].map(label =>
            <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{report.rows.map(row => <tr key={row.id}>
            <td className="p-3">{row.date.split('-').reverse().join('/')}<span className="block text-xs text-text-muted">{row.start_time}–{row.end_time}</span></td>
            <td className="p-3">{row.unit}<span className="block text-xs text-text-muted">{row.sector}{row.specialty && ' · ' + row.specialty}</span></td>
            <td className="p-3">{row.doctor || '—'}</td><td className="p-3">{shiftReportStates[row.status]}</td>
            {report.attendance && <td className="p-3">{row.presence ? presenceReportStates[row.presence] : '—'}</td>}
            {report.finance && <td className="p-3">{row.payment ? financeStateLabels[row.payment] : '—'}</td>}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>}
  </div>;
}

export default function ShiftReportPage({ initial }: { initial: Record<string, string> }) {
  const activeOrganization = useStore(state => state.activeOrganizationId);
  return <AccessGuard requiredPermission="relatorios"><Report key={activeOrganization} initial={initial} activeOrganization={activeOrganization}/></AccessGuard>;
}
