'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, WalletCards } from 'lucide-react';
import Dialog from '@/components/Dialog';
import { useShiftRates } from '@/components/schedule/ShiftFinancialDetails';
import { canEditPermission, canViewPermission } from '@/lib/permissions';
import { formatShiftMoney, hasRateAmount, parseMoneyCents, rateScopeLabel, shiftTypeLabels } from '@/lib/shiftPricing';
import { saveShiftRate } from '@/services/supabaseService';
import { useStore } from '@/store/useStore';
import type { ShiftRate } from '@/types';

function RateSettings({ organization, canEdit }: { organization: string; canEdit: boolean }) {
  const { organizations, units, sectors } = useStore();
  const company = organizations.find(item => item.id === organization);
  const companyUnits = units.filter(item => item.organizationId === organization);
  const companySectors = sectors.filter(item => item.organizationId === organization);
  const { rates: rateRows, error, ready, reload } = useShiftRates(organization, true);
  const rates = rateRows.filter(hasRateAmount);
  const [editing, setEditing] = useState<ShiftRate | 'new' | null>(null);
  const [unit, setUnit] = useState('');
  const [sector, setSector] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const existing = editing && editing !== 'new' ? editing : undefined;
  const specialties = [...new Set([...(company?.settings.specialties || []), ...companySectors.flatMap(item => item.specialties), existing?.specialty || ''].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  function edit(rule: ShiftRate | 'new') {
    setEditing(rule);
    setUnit(rule === 'new' ? '' : rule.unit_id || '');
    setSector(rule === 'new' ? '' : rule.sector_id || '');
    setFailure('');
    setNotice('');
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || !editing || busy) return;
    setFailure('');
    const fields = new FormData(event.currentTarget);
    const amount = parseMoneyCents(String(fields.get('amount') || ''));
    if (amount === null) return setFailure('Informe um valor em reais, com até duas casas decimais.');
    const duration = fields.get('duration');
    setBusy(true);
    try {
      await saveShiftRate(organization, existing?.id || null, {
        unit_id: unit || null, sector_id: sector || null, specialty: String(fields.get('specialty') || '') || null,
        duration_minutes: duration ? Number(duration) : null, shift_type: (fields.get('type') || null) as ShiftRate['shift_type'],
        turn: (fields.get('turn') || null) as ShiftRate['turn'], amount_cents: amount, active: fields.has('active'),
      });
      setEditing(null);
      setNotice('Valor padrão salvo. Os acordos já registrados foram preservados.');
      reload();
    } catch (saveError) { setFailure(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a regra.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href="/financeiro" className="text-sm font-semibold text-primary underline">Voltar ao financeiro</Link>
        <h1 className="nv-page-title mt-2 flex items-center gap-2"><WalletCards size={23} className="shrink-0 text-primary" aria-hidden="true" /> Valores de plantões</h1>
        <p className="mt-2 text-sm text-text-muted">Referências de {company?.name || 'empresa ativa'} para a negociação de novos plantões.</p>
      </div>
      {canEdit && <button className="nv-button" type="button" onClick={() => edit('new')} disabled={!ready}><Plus size={17} aria-hidden="true" /> Nova regra</button>}
    </header>
    <section className="nv-panel space-y-3 p-4 sm:p-5" aria-label="Valores padrão cadastrados">
      <p className="text-sm text-text-secondary">O posto tem prioridade sobre a unidade, seguida da empresa. Dentro de cada nível, o sistema prioriza especialidade, turno, duração e modalidade assistencial, nessa ordem.</p>
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error} <button type="button" className="font-semibold underline" onClick={reload}>Tentar novamente</button></p>}
      {!ready && !error && <p role="status" className="text-sm text-text-muted">Carregando referências…</p>}
      {ready && rates.length === 0 && <p className="nv-empty">Nenhum valor padrão cadastrado. Ainda é possível definir o valor diretamente na ficha do plantão.</p>}
      {ready && rates.length > 0 && <ul className="divide-y divide-border border-t border-border">
        {rates.map(rule => <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="wrap-anywhere font-medium">{rateScopeLabel(rule, companyUnits.find(item => item.id === rule.unit_id)?.name, companySectors.find(item => item.id === rule.sector_id)?.name)}</p>
            <p className="mt-1 text-sm text-text-secondary">{formatShiftMoney(rule.amount_cents)} <span className="nv-badge ml-1">{rule.active ? 'Ativa' : 'Inativa'}</span></p></div>
          {rule.post_default && rule.unit_id ? <Link className="nv-button-secondary" href={`/unidades/${rule.unit_id}`}>Ver configuração do posto</Link>
            : canEdit && <button type="button" className="nv-button-secondary" onClick={() => edit(rule)}>Editar regra</button>}
        </li>)}
      </ul>}
    </section>
    {editing && canEdit && <Dialog title={existing ? 'Editar valor padrão' : 'Novo valor padrão'} onClose={() => { if (!busy) setEditing(null); }}>
      <form className="space-y-4" onSubmit={save}>
        <p className="text-sm text-text-muted">Campos em branco deixam a regra válida para qualquer opção daquele campo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="nv-label">Unidade<select className="nv-input" value={unit} onChange={event => { setUnit(event.target.value); setSector(''); }}>
            <option value="">Todas as unidades</option>{companyUnits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className="nv-label">Posto<select className="nv-input" value={sector} disabled={!unit} onChange={event => setSector(event.target.value)}>
            <option value="">Todos os postos</option>{companySectors.filter(item => item.unitId === unit).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className="nv-label">Especialidade<select className="nv-input" name="specialty" defaultValue={existing?.specialty || ''}>
            <option value="">Todas as especialidades</option>{specialties.map(item => <option key={item}>{item}</option>)}
          </select></label>
          <label className="nv-label">Turno<select className="nv-input" name="turn" defaultValue={existing?.turn || ''}><option value="">Qualquer turno</option><option value="day">Diurno</option><option value="night">Noturno</option></select></label>
          <label className="nv-label">Duração exata (minutos)<input className="nv-input" name="duration" type="number" min={1} max={1439} step={1} placeholder="12 h = 720 min" defaultValue={existing?.duration_minutes ?? ''} /></label>
          <label className="nv-label">Modalidade assistencial<select className="nv-input" name="type" defaultValue={existing?.shift_type || ''}>
            <option value="">Todas as modalidades</option>{Object.entries(shiftTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
        <label className="nv-label">Valor padrão (R$)<input className="nv-input" name="amount" inputMode="decimal" placeholder="0,00" required defaultValue={existing ? (existing.amount_cents / 100).toFixed(2) : ''} /></label>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={existing?.active ?? true} /> Regra ativa</label>
        {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancelar</button><button className="nv-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar regra'}</button></div>
      </form>
    </Dialog>}
  </div>;
}

export default function ShiftRatesPage() {
  const { currentUser, activeOrganizationId } = useStore();
  if (!canViewPermission(currentUser, 'financeiro')) return <p className="nv-panel p-5 text-sm">Seu perfil não tem acesso aos valores de plantões.</p>;
  if (!activeOrganizationId) return <p className="nv-panel p-5 text-sm">Selecione uma empresa para consultar os valores de plantões.</p>;
  return <RateSettings key={activeOrganizationId} organization={activeOrganizationId} canEdit={canEditPermission(currentUser, 'financeiro')} />;
}
