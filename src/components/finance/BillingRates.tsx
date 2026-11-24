'use client';

import { useState, type FormEvent } from 'react';
import Dialog from '@/components/Dialog';
import { billingRpc, financialDate, money, type BillingCatalog, type BillingRate } from '@/lib/companyBilling';
import { notify } from '@/lib/notifications';
import type { Sector, Unit } from '@/types';

export default function BillingRates({ organization, catalog, units, sectors, specialties, canEdit, onChanged }: {
  organization: string; catalog: BillingCatalog; units: Unit[]; sectors: Sector[]; specialties: string[];
  canEdit: boolean; onChanged: () => void;
}) {
  const [editor, setEditor] = useState<'client' | 'contract' | 'rate'>();
  const [rate, setRate] = useState<BillingRate>();
  const [unitId, setUnitId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = (kind: typeof editor, item?: BillingRate) => {
    setEditor(kind);
    setRate(item);
    setUnitId(item?.unit_id || '');
    setError('');
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !editor) return;
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) || '').trim();
    setBusy(true);
    setError('');
    const finish = notify.saving();
    try {
      if (editor === 'rate') {
        const spec = Object.fromEntries(['contract_id','unit_id','sector_id','specialty','shift_type','shift_period','day_kind',
          'valid_from','valid_until','revenue_rate','medical_rate','revenue_premium','medical_premium'].map(name =>
          [name, field(name) || null]));
        await billingRpc('nv_save_billing_rate', { org: organization, target: rate?.id || null, spec, reason: field('reason') });
      } else {
        await billingRpc('nv_save_billing_client', { org: organization, target: null, name: field('name'), client: field('client') || null });
      }
      setEditor(undefined);
      onChanged();
      notify.success(editor === 'rate' ? 'Valor contratual salvo.' : 'Cadastro salvo.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
    } finally {
      finish();
      setBusy(false);
    }
  }
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="nv-section-title">Valores contratuais</h2>
      {canEdit && <div className="flex flex-wrap gap-2">
        <button type="button" className="nv-button-secondary" onClick={() => open('client')}>Nova contratante</button>
        <button type="button" className="nv-button-secondary" disabled={!catalog.clients.length} onClick={() => open('contract')}>Novo contrato</button>
        <button type="button" className="nv-button" disabled={!catalog.contracts.length} onClick={() => open('rate')}>Novo valor</button>
      </div>}
    </div>
    <div className="nv-panel overflow-x-auto" tabIndex={0} role="region" aria-label="Tabela de valores contratuais">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-surface-muted"><tr>{['Contrato','Escopo','Vigência','Receita por hora','Custo por hora','Ação'].map(label =>
          <th scope="col" className="px-3 py-3" key={label}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{catalog.rates?.map(item => {
          const contract = catalog.contracts.find(contract => contract.id === item.contract_id);
          const client = catalog.clients.find(client => client.id === contract?.client_id)?.name;
          const scope = [units.find(unit => unit.id === item.unit_id)?.name, sectors.find(sector => sector.id === item.sector_id)?.name,
            item.specialty, item.shift_type && ({ onsite: 'Presencial', oncall: 'Sobreaviso', telemedicine: 'Telemedicina' }[item.shift_type]),
            item.shift_period && (item.shift_period === 'night' ? 'Noturno' : 'Diurno'),
            item.day_kind && ({ weekday: 'Dia útil', weekend: 'Fim de semana', holiday: 'Feriado' }[item.day_kind])].filter(Boolean).join(' · ');
          return <tr key={item.id}>
            <td className="px-3 py-3 font-medium">{contract?.name}<span className="block text-xs text-text-muted">{client}</span></td>
            <td className="px-3 py-3">{scope || 'Geral'}</td>
            <td className="px-3 py-3">{financialDate(item.valid_from)} até {item.valid_until ? financialDate(item.valid_until) : 'indeterminada'}</td>
            <td className="px-3 py-3 tabular-nums">{money.format(item.revenue_rate + item.revenue_premium)}</td>
            <td className="px-3 py-3 tabular-nums">{money.format(item.medical_rate + item.medical_premium)}</td>
            <td className="px-3 py-3">{canEdit && <button type="button" className="nv-button-secondary" onClick={() => open('rate', item)}>Editar</button>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!catalog.rates?.length && <p className="p-4 text-sm text-text-muted">Nenhum valor contratual cadastrado.</p>}
    </div>
    {editor && <Dialog title={editor === 'client' ? 'Nova contratante' : editor === 'contract' ? 'Novo contrato' : rate ? 'Editar valor contratual' : 'Novo valor contratual'}
      onClose={() => { if (!busy) setEditor(undefined); }} closeDisabled={busy}>
      <form className="space-y-4" onSubmit={save} aria-busy={busy}>
        {editor !== 'rate' ? <>
          {editor === 'contract' && <label className="nv-label">Contratante<select className="nv-input" name="client" required>
            <option value="">Selecione</option>{catalog.clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
          <label className="nv-label">Nome<input className="nv-input" name="name" maxLength={150} required/></label>
        </> : <>
          <label className="nv-label">Contrato<select className="nv-input" name="contract_id" required defaultValue={rate?.contract_id || ''}>
            <option value="">Selecione</option>{catalog.contracts.map(item => <option key={item.id} value={item.id}>{item.name} · {catalog.clients.find(client => client.id === item.client_id)?.name}</option>)}
          </select></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="nv-label">Unidade<select className="nv-input" name="unit_id" value={unitId} onChange={event => setUnitId(event.target.value)}>
              <option value="">Todas</option>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="nv-label">Setor<select key={unitId} className="nv-input" name="sector_id" disabled={!unitId} defaultValue={unitId === rate?.unit_id ? rate?.sector_id || '' : ''}>
              <option value="">Todos</option>{sectors.filter(item => item.unitId === unitId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label className="nv-label">Especialidade<select className="nv-input" name="specialty" defaultValue={rate?.specialty || ''}>
              <option value="">Todas</option>{specialties.map(item => <option key={item}>{item}</option>)}
            </select></label>
            <label className="nv-label">Tipo de plantão<select className="nv-input" name="shift_type" defaultValue={rate?.shift_type || ''}>
              <option value="">Todos</option><option value="onsite">Presencial</option><option value="oncall">Sobreaviso</option><option value="telemedicine">Telemedicina</option>
            </select></label>
            <label className="nv-label">Turno<select className="nv-input" name="shift_period" defaultValue={rate?.shift_period || ''}>
              <option value="">Todos</option><option value="day">Diurno</option><option value="night">Noturno</option>
            </select></label>
            <label className="nv-label">Dia<select className="nv-input" name="day_kind" defaultValue={rate?.day_kind || ''}>
              <option value="">Todos</option><option value="weekday">Dia útil</option><option value="weekend">Fim de semana</option><option value="holiday">Feriado</option>
            </select></label>
            <label className="nv-label">Início da vigência<input className="nv-input" name="valid_from" type="date" required defaultValue={rate?.valid_from}/></label>
            <label className="nv-label">Fim da vigência<input className="nv-input" name="valid_until" type="date" defaultValue={rate?.valid_until || ''}/></label>
            <label className="nv-label">Receita por hora (R$)<input className="nv-input" name="revenue_rate" type="number" min="0" step="0.0001" required defaultValue={rate?.revenue_rate}/></label>
            <label className="nv-label">Valor médico por hora (R$)<input className="nv-input" name="medical_rate" type="number" min="0" step="0.0001" required defaultValue={rate?.medical_rate}/></label>
            <label className="nv-label">Adicional de receita por hora (R$)<input className="nv-input" name="revenue_premium" type="number" min="0" step="0.0001" defaultValue={rate?.revenue_premium}/></label>
            <label className="nv-label">Adicional médico por hora (R$)<input className="nv-input" name="medical_premium" type="number" min="0" step="0.0001" defaultValue={rate?.medical_premium}/></label>
          </div>
          <label className="nv-label">Justificativa<textarea className="nv-input" name="reason" required minLength={3} maxLength={1000}/></label>
        </>}
        {error && <p role="alert" className="nv-feedback text-danger">{error}</p>}
        <button className="nv-button" disabled={busy}>Salvar</button>
      </form>
    </Dialog>}
  </section>;
}
