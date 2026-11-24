'use client';

import { useEffect, useState } from 'react';
import BillingRates from './BillingRates';
import BillingNav from './BillingNav';
import BillingActionDialog, { type BillingAction } from './BillingActionDialog';
import { billingRpc, financialDate, hours, money, type BillingCatalog, type BillingInvoiceDetail,
  type BillingPeriod } from '@/lib/companyBilling';
import { saoPauloDate } from '@/lib/financeState';
import { canPerformAction } from '@/lib/permissions';
import { useStore } from '@/store/useStore';

const descriptions = { billing: 'Planejamento, apuração e emissão por competência.', receivable: 'Repasses conciliados com faturamentos emitidos.', rates: '' };
const titles = { billing: 'Faturamento', receivable: 'Contas a receber', rates: 'Valores contratuais' };
export type CompanyFinanceTab = keyof typeof titles;

export default function CompanyFinance({ tab, initialMonth }: { tab: CompanyFinanceTab; initialMonth?: string }) {
  const organization = useStore(state => state.activeOrganizationId);
  return <CompanyFinanceScope key={organization + tab} tab={tab} initialMonth={initialMonth} organization={organization}/>;
}

function CompanyFinanceScope({ tab, initialMonth, organization }: { tab: CompanyFinanceTab; initialMonth?: string; organization: string }) {
  const store = useStore();
  const [month, setMonth] = useState(initialMonth || saoPauloDate().slice(0, 7));
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{ key: string; catalog: BillingCatalog; period?: BillingPeriod }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [action, setAction] = useState<BillingAction>();
  const [opening, setOpening] = useState(false);
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [unitId, setUnitId] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [clientId, setClientId] = useState('');
  const [contractId, setContractId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [doctor, setDoctor] = useState('');
  const [status, setStatus] = useState('');
  const can = (key: Parameters<typeof canPerformAction>[2]) => canPerformAction(store.currentUser, 'financeiro', key);
  const permitted = tab === 'rates' ? can('rates_view') : can('billing_view');
  const first = month + '-01';
  const key = [organization, month, tab, revision].join('/');
  const catalog = view?.key === key ? view.catalog : undefined;
  const period = view?.key === key ? view.period : undefined;
  const org = store.organizations.find(item => item.id === organization);
  const units = store.units.filter(item => item.organizationId === organization);
  const sectors = store.sectors.filter(item => item.organizationId === organization);
  const specialties = org?.settings?.specialties || [];
  const today = saoPauloDate();

  useEffect(() => {
    if (!organization || !permitted || !month) return;
    let active = true;
    void Promise.all([
      billingRpc<BillingCatalog>('nv_billing_catalog', { org: organization }),
      tab === 'rates' ? Promise.resolve(undefined) : billingRpc<BillingPeriod>('nv_billing_period_work', { org: organization, month: first }),
    ]).then(([catalog, period]) => { if (active) setView({ key, catalog, period }); })
      .catch(error => { if (active) setFailure({ key, message: error instanceof Error ? error.message : 'Consulta indisponível.' }); });
    return () => { active = false; };
  }, [organization, permitted, month, first, tab, key]);

  function reload() {
    setSelected([]);
    setRevision(value => value + 1);
  }
  async function openInvoice(target: string) {
    if (opening) return;
    setOpening(true);
    setActionError('');
    try { setAction({ kind: 'invoice', invoice: await billingRpc<BillingInvoiceDetail>('nv_billing_invoice_detail', { target }) }); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Não foi possível consultar o faturamento.'); }
    finally { setOpening(false); }
  }

  function matchesScope(item: { contract_id: string | null; unit_id: string; sector_id: string | null }) {
    const contract = catalog?.contracts.find(contract => contract.id === item.contract_id);
    return (!clientId || contract?.client_id === clientId) && (!contractId || item.contract_id === contractId)
      && (!unitId || item.unit_id === unitId) && (!sectorId || item.sector_id === sectorId);
  }

  const visibleShifts = (period?.shifts || []).filter(item => matchesScope(item) && (!specialty || item.specialty === specialty)
    && (!doctor || item.doctor_id === doctor) && (!status || status === (item.invoice_id ? 'consolidated' : item.assessed_at ? 'assessed' : item.contract_id ? 'planned' : 'missing')));
  const invoiceState = (item: BillingPeriod['invoices'][number]) => !item.issued_on ? 'draft'
    : item.balance === 0 ? 'received' : item.due_on < today ? 'overdue' : 'pending';
  const visibleInvoices = (period?.invoices || []).filter(item => matchesScope(item)
    && (tab !== 'receivable' || item.issued_on) && (tab !== 'receivable' || !status || invoiceState(item) === status));
  const checkedIds = visibleShifts.filter(item => selected.includes(item.id)).map(item => item.id);
  const labels: Record<string, string> = { planned: 'A apurar', assessed: 'Apurado', missing: 'Sem regra contratual',
    consolidated: 'Consolidado', draft: 'Consolidado', received: 'Liquidado', overdue: 'Vencido', pending: 'A receber' };
  const contractName = (id: string | null) => catalog?.contracts.find(item => item.id === id)?.name;
  const clientName = (id: string | null) => catalog?.clients.find(item => item.id === catalog.contracts.find(contract => contract.id === id)?.client_id)?.name;

  return <div className="min-w-0 space-y-5">
    <header className="space-y-1"><h1 className="nv-page-title">{titles[tab]}</h1>
      {descriptions[tab] && <p className="text-sm text-text-muted">{descriptions[tab]}</p>}</header>
    <BillingNav active={tab}/>
    {!permitted && <p role="alert" className="nv-feedback text-text-secondary">Seu perfil não tem acesso a esta área.</p>}
    {permitted && tab !== 'rates' && <section className="nv-panel min-w-0 space-y-3 p-4" aria-label="Filtros">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="nv-label">Competência<input type="month" className="nv-input" value={month} required
          onChange={event => { setMonth(event.target.value); setSelected([]); }}/></label>
        <label className="nv-label">Contratante<select className="nv-input" value={clientId} onChange={event => { setClientId(event.target.value); setContractId(''); }}>
          <option value="">Todas</option>{catalog?.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="nv-label">Contrato<select className="nv-input" value={contractId} onChange={event => setContractId(event.target.value)}>
          <option value="">Todos</option>{catalog?.contracts.filter(item => !clientId || item.client_id === clientId)
            .map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="nv-label">Unidade<select className="nv-input" value={unitId} onChange={event => { setUnitId(event.target.value); setSectorId(''); }}>
          <option value="">Todas</option>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className="nv-label">Setor<select className="nv-input" value={sectorId} onChange={event => setSectorId(event.target.value)}>
          <option value="">Todos</option>{sectors.filter(item => !unitId || item.unitId === unitId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {tab === 'billing' && <>
          <label className="nv-label">Especialidade<select className="nv-input" value={specialty} onChange={event => setSpecialty(event.target.value)}>
            <option value="">Todas</option>{specialties.map(item => <option key={item}>{item}</option>)}
          </select></label>
          <label className="nv-label">Médico<select className="nv-input" value={doctor} onChange={event => setDoctor(event.target.value)}>
            <option value="">Todos</option>{Array.from(new Map((period?.shifts || []).map(item => [item.doctor_id, item.doctor])).entries())
              .sort((a,b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
        </>}
        <label className="nv-label">Situação<select className="nv-input" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Todas</option>{(tab === 'billing' ? ['planned','assessed','missing','consolidated'] : ['received','overdue','pending'])
            .map(item => <option key={item} value={item}>{labels[item]}</option>)}
        </select></label>
      </div>
    </section>}
    {permitted && Boolean(month) && !catalog && failure?.key !== key && <p role="status" className="text-sm text-text-muted">Consultando dados financeiros…</p>}
    {failure?.key === key && <p role="alert" className="nv-feedback text-danger">{failure.message} <button className="underline" onClick={reload}>Tentar novamente</button></p>}
    {actionError && <p role="alert" className="nv-feedback text-danger">{actionError}</p>}
    {tab === 'rates' && catalog && <BillingRates organization={organization} catalog={catalog}
      units={units} sectors={sectors} specialties={specialties} canEdit={can('rates_edit')} onChanged={reload}/>}
    {tab === 'billing' && period && <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="nv-section-title">Apuração de plantões</h2>
        <div className="flex flex-wrap gap-2">
          {period.closed_at ? <>{can('period_reopen') && <button className="nv-button-secondary" onClick={() => setAction({ kind: 'reopen' })}>Reabrir competência</button>}
            <span className="self-center text-sm text-text-muted">Encerrada em {financialDate(period.closed_at)}</span></>
            : <>{can('period_close') && first < today.slice(0, 7) + '-01' && <button className="nv-button-secondary" onClick={() => setAction({ kind: 'close' })}>Fechar competência</button>}
            {can('billing_manage') && <button className="nv-button" disabled={!checkedIds.length}
              onClick={() => setAction({ kind: 'consolidate', shifts: checkedIds })}>Consolidar{checkedIds.length ? ' (' + checkedIds.length + ')' : ''}</button>}</>}
        </div>
      </div>
      <div role="region" aria-label="Apuração por plantão" tabIndex={0} className="nv-panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface-muted"><tr>{['Plantão','Contrato','Horas faturáveis','Receita apurada','Situação','Ações'].map(label =>
            <th scope="col" key={label} className="px-3 py-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{visibleShifts.map(item => <tr key={item.id}>
            <td className="px-3 py-3 font-medium">{item.doctor}<span className="block text-xs text-text-muted">{financialDate(item.date)} · {item.start_time}–{item.end_time}</span></td>
            <td className="px-3 py-3">{contractName(item.contract_id) || '—'}</td>
            <td className="px-3 py-3 tabular-nums">{item.billable_minutes == null ? '—' : hours.format(item.billable_minutes / 60) + ' h'}</td>
            <td className="px-3 py-3 tabular-nums">{item.assessed_revenue == null ? '—' : money.format(item.assessed_revenue)}</td>
            <td className="px-3 py-3">{labels[item.invoice_id ? 'consolidated' : item.assessed_at ? 'assessed' : item.contract_id ? 'planned' : 'missing']}</td>
            <td className="px-3 py-3">{!period.closed_at && can('billing_manage') && !item.invoice_id && item.ended && <div className="flex flex-wrap items-center gap-2">
              {item.assessed_at && <input type="checkbox" aria-label={'Selecionar ' + item.doctor + ', ' + financialDate(item.date)}
                checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>}
              {(item.contract_id || item.suggested_rate) && <button className="nv-button-secondary" onClick={() => setAction({ kind: 'assess', shift: item })}>
                {item.assessed_at ? 'Revisar' : item.suggested_rate ? 'Regularizar' : 'Apurar'}
              </button>}
            </div>}</td>
          </tr>)}</tbody>
        </table>
        {visibleShifts.length === 0 && <p className="p-4 text-sm text-text-muted">Nenhum plantão neste recorte.</p>}
      </div>
    </section>}
    {tab !== 'rates' && period && <section className="space-y-3">
      <h2 className="nv-section-title">{tab === 'billing' ? 'Grupos de faturamento' : 'Repasses por contratante'}</h2>
      <div role="region" aria-label="Faturamento por contrato" tabIndex={0} className="nv-panel overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-surface-muted"><tr>
          {['Contratante e contrato','Unidade e setor','Vencimento','Valor','Recebido','Saldo','Situação','Ação'].map(label =>
            <th scope="col" key={label} className="px-3 py-3">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{visibleInvoices.map(item => <tr key={item.id}>
            <td className="px-3 py-3 font-medium">{clientName(item.contract_id)}<span className="block text-xs text-text-muted">{contractName(item.contract_id)}</span></td>
            <td className="px-3 py-3">{units.find(unit => unit.id === item.unit_id)?.name}
              <span className="block text-xs text-text-muted">{sectors.find(sector => sector.id === item.sector_id)?.name}</span></td>
            <td className="px-3 py-3">{financialDate(item.due_on)}</td>
            <td className="px-3 py-3 tabular-nums">{money.format(item.billed)}</td>
            <td className="px-3 py-3 tabular-nums">{money.format(item.received)}</td>
            <td className="px-3 py-3 tabular-nums">{money.format(item.balance)}</td>
            <td className="px-3 py-3">{labels[invoiceState(item)]}</td>
            <td className="px-3 py-3"><button type="button" className="nv-button-secondary" disabled={opening} onClick={() => void openInvoice(item.id)}>Ver ficha</button></td>
          </tr>)}</tbody>
        </table>
        {visibleInvoices.length === 0 && <p className="p-4 text-sm text-text-muted">Nenhum faturamento neste recorte.</p>}
      </div>
    </section>}
    {action && catalog && <BillingActionDialog action={action} catalog={catalog} organization={organization}
      month={first} onClose={() => setAction(undefined)} onChanged={reload}/>}
  </div>;
}
