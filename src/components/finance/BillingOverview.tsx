'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import BillingNav from './BillingNav';
import { billingRpc, hours, money, type BillingCatalog } from '@/lib/companyBilling';
import { cashFinanceReports, companyFinanceReports, completeMonthRange, type CompanyFinanceRegime,
  type CompanyFinanceReport, type CompanyOverview } from '@/lib/companyFinanceReport';
import { saoPauloDate } from '@/lib/financeState';
import { canPerformAction } from '@/lib/permissions';
import { notify } from '@/lib/notifications';
import { useStore } from '@/store/useStore';

const financial = (value: number | null) => value == null ? '—' : money.format(value);
const duration = (value: number | null) => value == null ? '—' : hours.format(value / 60) + ' h';
const monthLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(value + 'T00:00:00Z'));
const competenceStates = { missing: 'Sem regra contratual', assessed: 'Apurado', billed: 'Faturado',
  paid: 'Plantão pago', unpaid: 'Plantão a pagar', received: 'Repasse liquidado', overdue: 'Repasse vencido', pending: 'Repasse pendente' };
const cashStates = { received: 'Repasses recebidos', paid: 'Pagamentos médicos' };

function FinanceTimeline({ data, cash }: { data: CompanyOverview['timeline']; cash: boolean }) {
  const maximum = Math.max(1, ...data.flatMap(item => [Math.abs(item.revenue || 0),Math.abs(item.cost || 0)]));
  return <section className="nv-panel min-w-0 space-y-3 p-4" aria-label={cash ? 'Movimentações por mês' : 'Resultado por competência'}>
    <h2 className="nv-section-title">{cash ? 'Movimentações por mês' : 'Resultado por competência'}</h2>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Valores mensais">
      <table className="w-full min-w-[540px] table-fixed text-left text-sm">
        <thead><tr className="border-b border-border text-text-muted">
          <th className="w-24 py-2" scope="col">Mês</th>
          <th className="px-2" scope="col">{cash ? 'Repasses recebidos' : 'Receita apurada'}</th>
          <th className="px-2" scope="col">{cash ? 'Pagamentos médicos' : 'Custo médico'}</th>
          <th className="w-32 px-2 text-right" scope="col">{cash ? 'Saldo de caixa' : 'Resultado bruto'}</th>
        </tr></thead>
        <tbody className="divide-y divide-border">{data.map(item => <tr key={item.month}>
          <th className="py-3 font-medium capitalize" scope="row">{monthLabel(item.month)}</th>
          {([['revenue','bg-primary'],['cost','bg-accent']] as const).map(([key,color]) =>
            <td key={key} className="px-2 py-2 tabular-nums">{financial(item[key])}
              {item[key] != null && <div aria-hidden="true" className="mt-1 h-1.5 rounded bg-surface-muted">
                <div className={'h-full rounded ' + color} style={{ width: Math.abs(item[key] || 0) / maximum * 100 + '%' }}/>
              </div>}
            </td>)}
          <td className="px-2 text-right font-semibold tabular-nums">{financial(cash ? (item.revenue || 0) - (item.cost || 0)
            : item.revenue != null && item.cost != null ? item.revenue - item.cost : null)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!data.length && <p className="text-sm text-text-muted">Nenhum registro neste período.</p>}
  </section>;
}

export default function BillingOverview({ reports }: { reports?: boolean }) {
  const organization = useStore(state => state.activeOrganizationId);
  return <OverviewScope key={organization + String(reports)} organization={organization} reports={Boolean(reports)}/>;
}

function OverviewScope({ organization, reports }: { organization: string; reports: boolean }) {
  const store = useStore();
  const today = saoPauloDate();
  const [regime, setRegime] = useState<CompanyFinanceRegime>('competence');
  const [firstMonth, setFirstMonth] = useState(today.slice(0,7));
  const [lastMonth, setLastMonth] = useState(today.slice(0,7));
  const [firstDate, setFirstDate] = useState(today.slice(0,7) + '-01');
  const [lastDate, setLastDate] = useState(today);
  const [unit, setUnit] = useState('');
  const [sector, setSector] = useState('');
  const [client, setClient] = useState('');
  const [contract, setContract] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [doctor, setDoctor] = useState('');
  const [state, setState] = useState('');
  const [report, setReport] = useState<CompanyFinanceReport>('monthly');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [catalog, setCatalog] = useState<BillingCatalog>();
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; result?: CompanyOverview; error?: string }>();
  const cash = regime === 'cash';
  const authorized = canPerformAction(store.currentUser, 'financeiro', 'billing_view');
  const canExport = canPerformAction(store.currentUser, 'financeiro', 'export');
  const org = store.organizations.find(item => item.id === organization);
  const filterFrom = cash ? firstDate : completeMonthRange(firstMonth,lastMonth)?.start;
  const filterTo = cash ? lastDate : completeMonthRange(firstMonth,lastMonth)?.end;
  const validPeriod = Boolean(filterFrom && filterTo && filterFrom <= filterTo && Date.parse(filterTo) - Date.parse(filterFrom) <= 365 * 86400000);
  const params = { org: organization, from_date: filterFrom, to_date: filterTo, regime,
    filters: { unit,sector,client,contract,specialty,doctor,state } };
  const key = JSON.stringify(params);
  const overview = snapshot?.key === key ? snapshot.result : undefined;
  const overviewError = snapshot?.key === key ? snapshot.error : undefined;
  const availableReports = (Object.entries(companyFinanceReports) as [CompanyFinanceReport,string][])
    .filter(([value]) => !cash || cashFinanceReports.includes(value));

  useEffect(() => {
    if (!authorized || !organization) return;
    let active = true;
    void billingRpc<BillingCatalog>('nv_billing_catalog', { org: organization })
      .then(result => { if (active) { setCatalog(result); setCatalogFailed(false); } })
      .catch(() => { if (active) setCatalogFailed(true); });
    return () => { active = false; };
  }, [authorized, organization, revision]);
  useEffect(() => {
    if (!authorized || !organization || !validPeriod || reports) return;
    let active = true;
    void billingRpc<CompanyOverview>('nv_finance_company_report', JSON.parse(key))
      .then(result => { if (active) setSnapshot({ key,result }); })
      .catch(failure => { if (active) setSnapshot({ key,error: failure instanceof Error ? failure.message : 'Consulta indisponível.' }); });
    return () => { active = false; };
  }, [authorized, organization, validPeriod, reports, key, revision]);

  function selectRegime(next: CompanyFinanceRegime) {
    setRegime(next);
    setState('');
    if (next === 'cash' && !cashFinanceReports.includes(report)) setReport('payments');
  }

  async function download(format: 'csv' | 'xlsx') {
    if (exporting || !validPeriod || !filterFrom || !filterTo) return;
    setExporting(true);
    setExportError('');
    try {
      const query = new URLSearchParams({ empresa: organization, inicio: filterFrom, fim: filterTo, regime,
        format, relatorio: report, ...params.filters });
      const response = await fetch('/api/reports/company-finance?' + query);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Não foi possível exportar.');
      }
      const file = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = file;
      anchor.download = 'nvmed-' + report + '-' + filterFrom + '-' + filterTo + '.' + format;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(file),1000);
      notify.success('Relatório exportado.');
    } catch (failure) {
      setExportError(failure instanceof Error ? failure.message : 'Não foi possível exportar.');
    } finally {
      setExporting(false);
    }
  }

  const metrics = overview ? cash ? [
    ['Repasses recebidos', financial(overview.received)], ['Pagamentos médicos',financial(overview.paid)],
    ['Saldo de caixa dos serviços',financial(overview.net_cash)],
  ] : [
    ['Receita prevista',financial(overview.expected_revenue)],['Receita apurada',financial(overview.assessed_revenue)],
    ['Valor faturado',financial(overview.billed)],['Repasses recebidos',financial(overview.received)],
    ['Repasses pendentes',financial(overview.receivable)],['Repasses vencidos',financial(overview.overdue)],
    ['Custo médico apurado',financial(overview.medical_cost)],['Resultado bruto',financial(overview.gross_result)],
    ['Margem bruta',overview.gross_margin == null ? '—' : hours.format(overview.gross_margin) + '%'],
    ['Plantões pagos',hours.format(overview.paid_count)],['Plantões a pagar',hours.format(overview.payable_count)],
    ['Horas realizadas',duration(overview.worked_minutes)],['Horas faturáveis',duration(overview.billable_minutes)],
  ] : [];
  return <div className="min-w-0 space-y-5">
    <header className="space-y-1"><h1 className="nv-page-title">{reports ? 'Relatórios financeiros' : 'Visão geral financeira'}</h1>
      {org?.name && <p className="text-sm text-text-muted">{org.name}</p>}</header>
    <BillingNav active={reports ? 'reports' : 'overview'}/>
    {!authorized && <p role="alert" className="nv-feedback text-text-secondary">Seu perfil não tem acesso a esta área.</p>}
    {authorized && <>
      {catalogFailed && <p role="alert" className="nv-feedback text-danger">Não foi possível carregar os contratos. <button className="underline" onClick={() => setRevision(value => value+1)}>Tentar novamente</button></p>}
      <section className="nv-panel min-w-0 space-y-4 p-4" aria-label="Período e filtros">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="nv-label">Regime<select className="nv-input" value={regime} onChange={event => selectRegime(event.target.value as CompanyFinanceRegime)}>
            <option value="competence">Competência</option><option value="cash">Caixa</option>
          </select></label>
          <label className="nv-label">De<input className="nv-input" type={cash ? 'date' : 'month'}
            value={cash ? firstDate : firstMonth} onChange={event => cash ? setFirstDate(event.target.value) : setFirstMonth(event.target.value)}/></label>
          <label className="nv-label">Até<input className="nv-input" type={cash ? 'date' : 'month'}
            value={cash ? lastDate : lastMonth} onChange={event => cash ? setLastDate(event.target.value) : setLastMonth(event.target.value)}/></label>
        </div>
        <p className="text-sm text-text-muted">{cash ? 'O caixa usa as datas dos repasses, pagamentos e estornos.' : 'A competência usa o mês do plantão e vincula os repasses aos faturamentos desse período.'}</p>
        <details><summary className="min-h-9 cursor-pointer content-center text-sm font-medium">Filtros
          {Object.values(params.filters).filter(Boolean).length > 0 && ' · filtros ativos'}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="nv-label">Contratante<select className="nv-input" value={client} onChange={event => { setClient(event.target.value); setContract(''); }}>
              <option value="">Todas</option>{catalog?.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="nv-label">Contrato<select className="nv-input" value={contract} onChange={event => setContract(event.target.value)}>
              <option value="">Todos</option>{catalog?.contracts.filter(item => !client || item.client_id === client).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="nv-label">Unidade<select className="nv-input" value={unit} onChange={event => { setUnit(event.target.value); setSector(''); }}>
              <option value="">Todas</option>{store.units.filter(item => item.organizationId === organization).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="nv-label">Setor<select className="nv-input" value={sector} onChange={event => setSector(event.target.value)}>
              <option value="">Todos</option>{store.sectors.filter(item => item.organizationId === organization && (!unit || item.unitId === unit)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="nv-label">Especialidade<select className="nv-input" value={specialty} onChange={event => setSpecialty(event.target.value)}>
              <option value="">Todas</option>{org?.settings.specialties.map(item => <option key={item}>{item}</option>)}
            </select></label>
            <label className="nv-label">Médico<select className="nv-input" value={doctor} onChange={event => setDoctor(event.target.value)}>
              <option value="">Todos</option>{store.doctors.filter(item => item.organizationId === organization).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="nv-label">Situação financeira<select className="nv-input" value={state} onChange={event => setState(event.target.value)}>
              <option value="">Todas</option>{Object.entries(cash ? cashStates : competenceStates).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div>
        </details>
      </section>
      {!validPeriod && <p role="alert" className="nv-feedback text-danger">Selecione um período de até 366 dias.</p>}
      {(doctor || specialty) && <p className="text-sm text-text-muted">Repasses consolidados podem reunir médicos e especialidades do mesmo faturamento. Para consultá-los, retire esses filtros.</p>}
      {reports ? <section className="nv-panel space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="nv-label min-w-0 max-w-md flex-1">Relatório<select className="nv-input" value={report} onChange={event => setReport(event.target.value as CompanyFinanceReport)}>
            {availableReports.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {canExport && <div className="flex flex-wrap gap-2">
            <button className="nv-button-secondary" disabled={exporting || !validPeriod} onClick={() => void download('csv')}>Baixar CSV</button>
            <button className="nv-button" disabled={exporting || !validPeriod} onClick={() => void download('xlsx')}>Baixar XLSX</button>
          </div>}
        </div>
        {exporting && <p role="status" className="text-sm text-text-muted">Preparando a exportação…</p>}
        {!canExport && <p className="text-sm text-text-muted">Seu perfil precisa de permissão para exportar.</p>}
        {exportError && <p role="alert" className="nv-feedback text-danger">{exportError}</p>}
        <Link className="text-sm font-medium text-primary underline" href="/financeiro/relatorio">Relatório de repasses PJ</Link>
      </section> : <>
        {validPeriod && !overview && !overviewError && <p role="status" className="text-sm text-text-muted">Consultando indicadores…</p>}
        {overviewError && <p role="alert" className="nv-feedback text-danger">{overviewError} <button className="underline" onClick={() => setRevision(value => value+1)}>Tentar novamente</button></p>}
        {overview && <>
          <dl aria-label="Indicadores" className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border p-4 md:grid-cols-3 xl:grid-cols-5">
            {metrics.map(([label,value]) => <div key={label} className="min-w-0 p-1">
              <dt className="text-sm text-text-muted">{label}</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{value}</dd>
            </div>)}
          </dl>
          {!cash && overview.missing_count > 0 && <Link className="inline-block text-sm font-medium text-primary underline"
            href={'/financeiro/empresa?aba=billing&mes=' + firstMonth}>{overview.missing_count} plantões sem regra contratual no período</Link>}
          <FinanceTimeline data={overview.timeline} cash={cash}/>
        </>}
      </>}
    </>}
  </div>;
}
