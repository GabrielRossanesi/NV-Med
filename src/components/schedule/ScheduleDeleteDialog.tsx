'use client';

import { useState } from 'react';
import { AlertTriangle, LoaderCircle, Trash2, UserMinus } from 'lucide-react';
import Dialog from '@/components/Dialog';
import { getScheduleDeletionTargets, type ScheduleDeletionSelection, type ScheduleDeletionScope } from '@/lib/scheduleDeletion';
import type { Doctor, Sector, Shift, Unit } from '@/types';

interface Props {
  initial: ScheduleDeletionSelection;
  organizationId: string;
  shifts: Shift[];
  sectors: Sector[];
  units: Unit[];
  doctors: Doctor[];
  canSeeFinancial: boolean;
  canEditFinancial: boolean;
  onClose: () => void;
  onConfirm: (targets: Shift[], scope: ScheduleDeletionScope) => Promise<string | null>;
}

const scopeLabels: Record<ScheduleDeletionScope, string> = {
  shift: 'Excluir plantão',
  turn: 'Excluir turno',
  period: 'Excluir período',
  doctor: 'Retirar médico da escala',
};

export default function ScheduleDeleteDialog({ initial, organizationId, shifts, sectors, units, doctors, canSeeFinancial, canEditFinancial, onClose, onConfirm }: Props) {
  const [selection, setSelection] = useState(initial);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const targets = getScheduleDeletionTargets(shifts, sectors, organizationId, selection);
  const assigned = targets.filter(shift => shift.doctorId).length;
  const paid = targets.filter(shift => shift.paymentStatus === 'paid').length;
  const financialItems = targets.filter(shift => shift.paymentStatus === 'paid' || Number(shift.paymentAmount) > 0).length;
  const isDoctor = selection.scope === 'doctor';
  const word = isDoctor ? 'RETIRAR' : 'EXCLUIR';
  const validRange = selection.scope === 'shift' || (selection.from && selection.to && selection.from <= selection.to);
  const validScope = selection.scope !== 'turn' || (selection.sectorId && selection.kind && selection.from === selection.to);
  const canConfirm = Boolean(validRange && validScope && targets.length > 0 && targets.length <= 500 && (canEditFinancial || financialItems === 0) && (selection.scope === 'shift' || confirmation === word));

  async function submit() {
    if (!canConfirm || saving) return;
    setSaving(true); setError('');
    try {
      const result = await onConfirm(targets, selection.scope);
      if (result) setError(result);
      else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.');
    } finally { setSaving(false); }
  }

  return <Dialog title={scopeLabels[selection.scope]} onClose={() => !saving && onClose()}>
    <div className="space-y-5">
      {initial.scope !== 'shift' && <label className="nv-label">Ação
        <select className="nv-input" value={selection.scope} onChange={event => { const scope = event.target.value as ScheduleDeletionScope; setSelection({ ...selection, scope, to: scope === 'turn' ? selection.from : selection.to }); setConfirmation(''); setError(''); }}>
          <option value="period">Excluir período</option><option value="turn">Excluir turno</option><option value="doctor">Retirar médico da escala</option>
        </select>
      </label>}
      {selection.scope === 'shift' ? <div className="text-sm text-text-secondary"><p className="font-semibold text-text-primary">{targets[0] ? `${new Date(`${targets[0].date}T12:00:00`).toLocaleDateString('pt-BR')} · ${targets[0].startTime}–${targets[0].endTime}` : 'Plantão não encontrado'}</p><p className="mt-1">{sectors.find(sector => sector.id === targets[0]?.sectorId)?.name || targets[0]?.sector || 'Setor'} · {doctors.find(doctor => doctor.id === targets[0]?.doctorId)?.name || 'Vaga aberta'}</p><p className="mt-2">Este posto será removido da escala. O cadastro do médico será preservado.</p></div> : <>
        <p className="text-sm text-text-secondary">{isDoctor ? 'Os plantões selecionados continuarão como vagas abertas. O cadastro do médico será preservado.' : 'Os postos salvos no recorte selecionado serão excluídos. A previsão de cobertura do setor continuará configurada.'}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="nv-label">{selection.scope === 'turn' ? 'Dia' : 'De'}<input className="nv-input" type="date" value={selection.from} onChange={event => setSelection({ ...selection, from: event.target.value, to: selection.scope === 'turn' ? event.target.value : selection.to })}/></label>
          {selection.scope !== 'turn' && <label className="nv-label">Até<input className="nv-input" type="date" min={selection.from} value={selection.to} onChange={event => setSelection({ ...selection, to: event.target.value })}/></label>}
          <label className="nv-label">Unidade<select className="nv-input" value={selection.unitId} onChange={event => setSelection({ ...selection, unitId: event.target.value, sectorId: '' })}><option value="">Todas as unidades</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label className="nv-label">Setor<select className="nv-input" value={selection.sectorId} onChange={event => setSelection({ ...selection, sectorId: event.target.value })}><option value="">{selection.scope === 'turn' ? 'Selecione o setor' : 'Todos os setores'}</option>{sectors.filter(sector => !selection.unitId || sector.unitId === selection.unitId).map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label>
          {selection.scope === 'turn' && <label className="nv-label">Turno<select className="nv-input" value={selection.kind} onChange={event => setSelection({ ...selection, kind: event.target.value as ScheduleDeletionSelection['kind'] })}><option value="">Selecione o turno</option><option value="day">Diurno</option><option value="night">Noturno</option></select></label>}
          {isDoctor && <label className="nv-label">Médico<select className="nv-input" value={selection.doctorId} onChange={event => setSelection({ ...selection, doctorId: event.target.value })}><option value="">Selecione o médico</option>{doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label>}
        </div>
      </>}
      <div className="border-l-2 border-danger bg-danger/[0.045] px-4 py-3 text-sm">
        <p className="font-semibold text-text-primary">{targets.length} {targets.length === 1 ? 'plantão atingido' : 'plantões atingidos'}</p>
        <p className="mt-1 text-xs text-text-secondary">{assigned} com médico · {targets.length - assigned} vagas abertas{canSeeFinancial && paid ? ` · ${paid} com pagamento marcado como pago` : ''}</p>
      </div>
      {!validRange && <p role="alert" className="flex items-center gap-2 text-xs text-danger"><AlertTriangle size={14}/>Informe um intervalo de datas válido.</p>}
      {selection.scope === 'turn' && !validScope && <p role="alert" className="flex items-center gap-2 text-xs text-danger"><AlertTriangle size={14}/>Selecione o setor e o turno.</p>}
      {targets.length > 500 && <p role="alert" className="text-xs text-danger">O limite é de 500 plantões por ação. Reduza o período ou escolha uma unidade ou setor.</p>}
      {!canEditFinancial && financialItems > 0 && <p role="alert" className="text-xs text-danger">Esta seleção contém plantões com dados financeiros. Solicite a alguém com permissão de edição financeira para concluir.</p>}
      {selection.scope !== 'shift' && targets.length > 0 && <label className="nv-label">Digite {word} para confirmar<input className="nv-input" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={word}/></label>}
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><button type="button" className="nv-button-secondary" disabled={saving} onClick={onClose}>Cancelar</button><button type="button" disabled={!canConfirm || saving} onClick={() => void submit()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-danger px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45">{saving ? <LoaderCircle size={15} className="animate-spin"/> : isDoctor ? <UserMinus size={15}/> : <Trash2 size={15}/>} {saving ? 'Aguarde…' : scopeLabels[selection.scope]}</button></div>
    </div>
  </Dialog>;
}
