'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import { createClient } from '@/lib/supabase/client';
import { employmentLabel, employmentLabels } from '@/lib/scheduling';
import { financeStateLabels, saoPauloDate } from '@/lib/financeState';
import { formatReportMoney, type summarizeReport } from '@/lib/reportSummary';
import { presenceReportStates, reportFilterKeys, reportFrequencyLabels, reportPeriodLabels, shiftReportStates, type ReportCatalog, type ShiftReport } from '@/lib/shiftReport';
import { useStore } from '@/store/useStore';

type Preview = ShiftReport & { total: number; summary: ReturnType<typeof summarizeReport> };
type Format = 'csv' | 'xlsx' | 'pdf';
const formats: Record<Format, string> = { csv: 'CSV', xlsx: 'Planilha XLSX', pdf: 'Documento PDF' };
const paymentLabels = { unpaid: 'Aguardando pagamento', ...financeStateLabels };
const isoDate = (value: string) => value.split('-').reverse().join('/');
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function Options({ values }: { values: Record<string, string> }) {
  return <><option value="">Todos</option>{Object.entries(values).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>;
}
function entries(items: { id: string; name: string }[]) {
  return Object.fromEntries(items.map(item => [item.id, item.name]));
}
function paramsFor(fields: Record<string, string>, financial: boolean) {
  return new URLSearchParams(Object.fromEntries(Object.entries({ ...fields, modo: financial ? 'financeiro' : 'operacional' }).filter(([, value]) => value))).toString();
}

function Report({ initial, activeOrganization, financial }: { initial: Record<string, string>; activeOrganization: string; financial: boolean }) {
  const { organizations, currentUser } = useStore();
  const today = saoPauloDate();
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    empresa: currentUser.type === 'tenant_user' ? currentUser.organizationId || activeOrganization : initial.empresa || activeOrganization,
    inicio: initial.inicio || today.slice(0, 7) + '-01',
    fim: initial.fim || today,
    ...Object.fromEntries(Object.keys(reportFilterKeys).filter(key => initial[key]).map(key => [key, initial[key]])),
  }));
  const [applied, setApplied] = useState(() => paramsFor(draft, financial));
  const [catalogResult, setCatalogResult] = useState<{ org: string; value?: ReportCatalog; error?: string }>();
  const [report, setReport] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const company = draft.empresa;
  const catalog = catalogResult?.org === company ? catalogResult?.value : undefined;
  const catalogError = catalogResult?.org === company ? catalogResult?.error : undefined;

  useEffect(() => {
    let live = true;
    const client = createClient();
    if (client && company) void client.rpc('nv_report_catalog', { org: company, financial_only: financial }).then(result => {
      if (!live) return;
      setCatalogResult(result.error ? { org: company, error: 'Filtros indisponíveis para esta empresa.' }
        : { org: company, value: result.data as ReportCatalog });
    });
    return () => { live = false; };
  }, [company, financial]);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/reports/shifts?' + applied, { signal: abort.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Não foi possível abrir o relatório.');
        if (!abort.signal.aborted) setReport(data);
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível abrir o relatório.');
      }
    })();
    return () => abort.abort();
  }, [applied]);

  function change(key: string, value: string) {
    setDraft(previous => ({
      ...previous, [key]: value,
      ...(key === 'empresa' ? { unidade: '', posto: '', medico: '', especialidade: '', presenca: '', pagamento: '',
        modalidade: '', vence_de: '', vence_ate: '', pago_de: '', pago_ate: '', plantao: '' } : {}),
      ...(key === 'unidade' ? { posto: '' } : {}),
    }));
  }
  function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!catalog) return;
    const selected = { ...draft };
    if (!catalog.finance) for (const key of ['pagamento', 'modalidade', 'vence_de', 'vence_ate', 'pago_de', 'pago_ate']) delete selected[key];
    if (!catalog.attendance) delete selected.presenca;
    const next = paramsFor(selected, financial);
    if (next !== applied) {
      setError('');
      setReport(null);
      setApplied(next);
    }
  }
  async function download(format: Format) {
    setBusy(true);
    setError('');
    if (menu.current) menu.current.open = false;
    try {
      const response = await fetch('/api/reports/shifts?' + applied + '&format=' + format);
      if (!response.ok) throw new Error((await response.json()).error || 'Não foi possível exportar.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'nvmed.' + format;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível exportar.');
    } finally {
      setBusy(false);
    }
  }

  function select(key: string, title: string, values: Record<string, string>) {
    return <label className="nv-label">{title}<select className="nv-input" value={draft[key] || ''} onChange={event => change(key, event.target.value)}>
      <Options values={values}/>
    </select></label>;
  }
  function input(key: string, title: string, type: 'date' | 'time', required = false) {
    return <label className="nv-label">{title}<input type={type} className="nv-input" required={required} value={draft[key] || ''} onChange={event => change(key, event.target.value)}/></label>;
  }
  const units = catalog?.units || [];
  const sectors = (catalog?.sectors || []).filter(item => !draft.unidade || item.unitId === draft.unidade);
  const reportHeading = financial ? 'Relatório financeiro' : 'Relatório de plantões';
  const changed = paramsFor(draft, financial) !== applied;
  return <div className="space-y-5">
    <header>
      <Link href={financial ? '/financeiro' : '/relatorios'} className="text-sm font-semibold text-primary hover:underline">{financial ? 'Voltar ao financeiro' : 'Voltar aos relatórios'}</Link>
      <h1 className="nv-page-title mt-2 flex items-center gap-2"><FileSpreadsheet size={24} className="text-primary"/>{reportHeading}</h1>
      <p className="mt-2 text-sm text-text-muted">Aplique os filtros para atualizar a prévia e os arquivos de exportação.</p>
    </header>
    <form className="space-y-4 rounded-xl border border-border bg-card-bg p-4 sm:p-5" onSubmit={apply}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="nv-label">Empresa<select className="nv-input" required value={company} onChange={event => change('empresa', event.target.value)}>
          <option value="">Selecione a empresa</option>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {input('inicio', 'Data inicial do plantão', 'date', true)}
        {input('fim', 'Data final do plantão', 'date', true)}
        {select('turno', 'Turno', reportPeriodLabels)}
        {select('unidade', 'Unidade', entries(units))}
        {select('posto', 'Setor', entries(sectors))}
        {select('especialidade', 'Especialidade', Object.fromEntries((catalog?.specialties || []).map(item => [item, item])))}
        {select('medico', 'Médico', entries(catalog?.doctors || []))}
        {!financial && select('contratacao', 'Modalidade de contratação', { ...employmentLabels, undefined: 'Não definida' })}
      </div>
      <details className="rounded-lg border border-border px-3 py-3">
        <summary className="cursor-pointer text-sm font-semibold">Horários e situações</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {input('hora_inicio', 'Início a partir de', 'time')}
          {input('hora_fim', 'Término até', 'time')}
          {select('situacao', 'Situação do plantão', { active: 'Ativos', ...shiftReportStates })}
          {catalog?.attendance && select('presenca', 'Presença', presenceReportStates)}
          {catalog?.finance && select('pagamento', 'Situação financeira', paymentLabels)}
          {catalog?.finance && select('modalidade', 'Modalidade de pagamento', reportFrequencyLabels)}
          {catalog?.finance && input('vence_de', 'Vencimento de', 'date')}
          {catalog?.finance && input('vence_ate', 'Vencimento até', 'date')}
          {catalog?.finance && input('pago_de', 'Pagamento de', 'date')}
          {catalog?.finance && input('pago_ate', 'Pagamento até', 'date')}
        </div>
        <p className="mt-2 text-xs text-text-muted">Quando o horário final é menor que o inicial, o filtro considera uma faixa que atravessa a meia-noite.</p>
      </details>
      {draft.plantao && <button type="button" className="text-sm text-primary underline" onClick={() => change('plantao', '')}>Remover filtro de plantão específico</button>}
      <div className="flex flex-wrap items-center gap-3"><button className="nv-button" disabled={!catalog}>Aplicar filtros</button>
        {catalogError && <p role="alert" className="text-xs text-danger">{catalogError}</p>}
        {changed && <p className="text-xs text-text-muted">A prévia ainda usa os filtros aplicados anteriormente.</p>}
      </div>
    </form>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!report && !error && <p role="status" className="text-sm text-text-muted">Carregando plantões…</p>}
    {report && <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{report.total} {report.total === 1 ? 'plantão encontrado' : 'plantões encontrados'}{report.total > 100 && ' · Prévia dos primeiros 100'}</p>
        <details ref={menu} className="relative w-full sm:w-auto">
          <summary className="nv-button-secondary cursor-pointer list-none"><Download size={15}/>{busy ? 'Preparando…' : 'Exportar relatório'}</summary>
          <div className="absolute inset-x-0 z-10 mt-1 grid min-w-44 gap-1 rounded-xl border border-border bg-card-bg p-1.5 shadow-soft sm:left-auto">
            {(Object.entries(formats) as [Format, string][]).map(([format, label]) => <button key={format} type="button" disabled={busy || changed} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-state-hover disabled:opacity-50" onClick={() => void download(format)}>{label}</button>)}
          </div>
        </details>
      </div>
      {report.summary && <div className="grid gap-3 sm:grid-cols-3">
        {(['agreed', 'paid', 'balance'] as const).map((key, index) => <div key={key} className="rounded-xl border border-border bg-card-bg p-4">
          <p className="text-xs text-text-muted">{['Valor combinado', 'Valor pago', 'Saldo pendente'][index]}</p>
          <strong className="mt-1 block text-lg tabular-nums">{formatReportMoney(report.summary!.totals[key])}</strong>
        </div>)}
      </div>}
      {report.rows.length > 0 ? <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[660px] text-left text-sm">
          <thead className="bg-surface-muted"><tr>{['Data', 'Unidade e setor', 'Médico', 'Contratação', 'Situação', ...(report.attendance ? ['Presença'] : []), ...(report.finance ? ['Pagamento', 'Combinado', 'Pago', 'Saldo'] : [])].map(label =>
            <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{report.rows.map(row => <tr key={row.id}>
            <td className="p-3">{isoDate(row.date)}<span className="block text-xs text-text-muted">{row.start_time}–{row.end_time}</span></td>
            <td className="p-3">{row.unit}<span className="block text-xs text-text-muted">{row.sector}{row.specialty && ' · ' + row.specialty}</span></td>
            <td className="p-3">{row.doctor || '—'}</td><td className="p-3">{employmentLabel(row.employment)}</td><td className="p-3">{shiftReportStates[row.status]}</td>
            {report.attendance && <td className="p-3">{row.presence ? presenceReportStates[row.presence] : '—'}</td>}
            {report.finance && <><td className="p-3">{row.payment ? financeStateLabels[row.payment] : '—'}{row.due && <span className="block text-xs text-text-muted">Venc. {isoDate(row.due)}</span>}</td>
              {[row.agreed, row.paid_amount, row.balance].map((amount, index) => <td key={index} className="whitespace-nowrap p-3 tabular-nums">{amount == null ? '—' : brl.format(amount)}</td>)}</>}
          </tr>)}</tbody>
        </table>
      </div> : <p className="rounded-xl border border-dashed border-border p-5 text-sm text-text-muted">Nenhum plantão encontrado para os filtros aplicados.</p>}
    </section>}
  </div>;
}

export default function ShiftReportPage({ initial, financial = false }: { initial: Record<string, string>; financial?: boolean }) {
  const activeOrganization = useStore(state => state.activeOrganizationId);
  return <AccessGuard requiredPermission={financial ? 'financeiro' : 'relatorios'}><Report key={activeOrganization} initial={initial} activeOrganization={activeOrganization} financial={financial}/></AccessGuard>;
}
