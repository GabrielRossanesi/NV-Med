'use client';
import { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { scheduleHistory } from '@/services/masterScheduleService';
import { scheduleAuditLabels, scheduleOriginLabels, type ScheduleAuditEntry, type ScheduleHistoryPage } from '@/lib/scheduleAudit';
import type { Sector, Shift, Unit } from '@/types';
import { shiftApprovalLabels } from '@/lib/shiftApproval';

const fieldLabels: Record<string, string> = { coverage_post_id: 'Posto previsto', capacity: 'Capacidade simultânea',
  operational_date: 'Data operacional', approval_source: 'Aprovação', reason: 'Justificativa', doctor: 'Médico', date: 'Dia do plantão', start_time: 'Início', end_time: 'Término', status: 'Situação',
  unit_id: 'Unidade', sector_id: 'Setor', specialty: 'Especialidade', type: 'Modalidade', employment_type: 'Contratação', start_date: 'Data inicial', end_date: 'Data final',
  frequency: 'Frequência', interval_weeks: 'Intervalo em semanas', weekdays: 'Dias da semana', anchor_date: 'Data de referência', horizon_months: 'Meses futuros', employer_name: 'Empregador', coverage_mode: 'Cobertura', kind: 'Tipo de ausência', coverage_reason_updated: 'Motivo da cobertura', private_note_updated: 'Observação privada' };
const values: Record<string, string> = { active: 'Ativo', suspended: 'Suspenso', ended: 'Encerrado', cancelled: 'Cancelado', pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', open: 'Vaga aberta', scheduled: 'Programada', weeks: 'Semanas', monthly: 'Mensal', clt: 'CLT', pj: 'PJ', concursado: 'Prefeitura', onsite: 'Presencial', oncall: 'Sobreaviso', telemedicine: 'Telemedicina' };
const timestamp = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
function flattened(value: Record<string, unknown> | null) { return { ...(value?.definition as Record<string, unknown> || {}), ...value }; }
function Changes({ entry, units, sectors }: { entry: ScheduleAuditEntry; units: Unit[]; sectors: Sector[] }) {
  const old = flattened(entry.previous), next = flattened(entry.next);
  function format(key: string, value: unknown) {
    if (value == null || value === '') return '—';
    if (key === 'reason') return String(value);
    if (key === 'private_note_updated' || key === 'coverage_reason_updated') return 'Atualizada; conteúdo restrito';
    if (key === 'approval_source' && String(value) in shiftApprovalLabels) return shiftApprovalLabels[value as keyof typeof shiftApprovalLabels];
    if (key === 'kind') return ({ vacation: 'Férias', leave: 'Afastamento', license: 'Licença', unavailable: 'Indisponibilidade', other: 'Outro' } as Record<string, string>)[String(value)] || String(value);
    if (key === 'coverage_mode') return value === 'adhoc' ? 'Avulsa' : 'Regular';
    if (key === 'unit_id') return units.find(unit => unit.id === value)?.name || 'Unidade registrada';
    if (key === 'sector_id') return sectors.find(sector => sector.id === value)?.name || 'Setor registrado';
    if (key === 'weekdays' && Array.isArray(value)) return value.map(day => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][Number(day)]).join(', ');
    return values[String(value)] || String(value);
  }
  const keys = Object.keys(fieldLabels).filter(key => JSON.stringify(old[key]) !== JSON.stringify(next[key]));
  return keys.length ? <dl className="mt-3 space-y-2 border-l-2 border-border pl-3">{keys.map(key => <div key={key} className="text-xs"><dt className="font-semibold">{fieldLabels[key]}</dt><dd className="mt-1 break-words text-text-secondary">Anterior: {format(key, old[key])}<br/>Novo: {format(key, next[key])}</dd></div>)}</dl> : null;
}
export function ScheduleHistoryEvent({ entry, units, sectors }: { entry: ScheduleAuditEntry; units: Unit[]; sectors: Sector[] }) {
  return <li className="py-5"><p className="text-xs text-text-muted">{timestamp(entry.created_at)}</p>
    <h3 className="mt-1 text-sm font-semibold">{scheduleAuditLabels[entry.action] || 'Alteração registrada'}</h3>
    <p className="mt-1 break-words text-xs text-text-secondary">{entry.origin === 'cron' ? 'Sistema — Geração automática' : `${entry.actor_name || (entry.actor_id ? 'Usuário registrado' : 'Processo do sistema')}${entry.actor_role ? ` · ${entry.actor_role}` : ''}`} · {scheduleOriginLabels[entry.origin || ''] || 'Origem não registrada'}</p>
    <p className="mt-1 break-words text-xs text-text-muted">{[entry.organization, entry.unit, entry.sector, entry.shift_date].filter(Boolean).join(' · ') || 'Recorrência ou ausência vinculada'}</p>
    <Changes entry={entry} units={units} sectors={sectors}/>
    <details className="mt-3 text-xs text-text-muted"><summary className="min-h-8 cursor-pointer content-center">Identificação da operação</summary><dl className="space-y-1 break-all py-2">
      <div><dt className="inline font-medium">Registro: </dt><dd className="inline">{entry.id}</dd></div>
      <div><dt className="inline font-medium">{entry.shift_id ? 'Plantão' : 'Entidade'}: </dt><dd className="inline">{entry.shift_id || entry.entity_id}</dd></div>
      {entry.actor_id && <div><dt className="inline font-medium">Usuário: </dt><dd className="inline">{entry.actor_id}</dd></div>}
      {entry.organization_id && <div><dt className="inline font-medium">Empresa: </dt><dd className="inline">{entry.organization_id}</dd></div>}
      {entry.correlation_id && <div><dt className="inline font-medium">Correlação: </dt><dd className="inline">{entry.correlation_id}</dd></div>}
    </dl></details>
  </li>;
}
export default function ScheduleHistory({ organization, unitId, sectorIds, shiftId, units, sectors, shifts, onClose }: {
  organization: string; unitId: string; sectorIds: string[]; shiftId?: string; units: Unit[]; sectors: Sector[]; shifts: Shift[]; onClose: () => void;
}) {
  const [unit, setUnit] = useState(unitId);
  const [selectedSectors, setSectors] = useState<string[] | null>(sectorIds);
  const [from, setFrom] = useState(''); const [until, setUntil] = useState('');
  const [actor, setActor] = useState(''); const [action, setAction] = useState(''); const [shift, setShift] = useState(shiftId || '');
  const [result, setResult] = useState<{ key: string; data: ScheduleHistoryPage }>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const args = { org: organization, unit_filter: unit || null, sector_filters: selectedSectors, from_date: from || null, until_date: until || null,
    actor_filter: actor || null, action_filter: action || null, shift_filter: shiftId || shift || null, page_size: 30 };
  const key = JSON.stringify(args);
  const data = result?.key === key ? result.data : undefined;
  useEffect(() => {
    let live = true;
    void scheduleHistory(JSON.parse(key)).then(data => { if (live) { setResult({ key, data }); setError(''); } })
      .catch(failure => { if (live) setError(failure instanceof Error ? failure.message : 'Não foi possível consultar o histórico.'); });
    return () => { live = false; };
  }, [key]);
  async function more() {
    if (!data?.items.length) return; setBusy(true);
    try { const page = await scheduleHistory({ ...args, before_id: data.items.at(-1)!.id }); setResult(previous => previous?.key === key ? { key, data: { ...page, items: [...previous.data.items, ...page.items] } } : previous); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível carregar mais registros.'); }
    finally { setBusy(false); }
  }
  return <Dialog title="Histórico administrativo de escalas" size="lg" onClose={onClose}>
    <div className="space-y-5"><p className="text-xs text-text-muted">Horários de Brasília. Observações privadas e valores financeiros não são incluídos nesta linha do tempo.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="nv-label">De<input className="nv-input" type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label className="nv-label">Até<input className="nv-input" type="date" min={from} value={until} onChange={event => setUntil(event.target.value)}/></label>
        <label className="nv-label">Usuário<select className="nv-input" value={actor} onChange={event => setActor(event.target.value)}><option value="">Todos</option>{data?.actors.map(user => <option key={user.id} value={user.id}>{user.name || 'Usuário registrado'}</option>)}</select></label>
        <label className="nv-label">Unidade<select className="nv-input" value={unit} onChange={event => { setUnit(event.target.value); setSectors(null); if (!shiftId) setShift(''); }}><option value="">Todas autorizadas</option>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="nv-label">Setor<select className="nv-input" value={selectedSectors === null ? 'all' : selectedSectors.length === 1 ? selectedSectors[0] : 'selected'} onChange={event => { setSectors(event.target.value === 'all' ? null : event.target.value === 'selected' ? sectorIds : [event.target.value]); if (!shiftId) setShift(''); }}><option value="all">Todos autorizados</option>{(!unit || unit === unitId) && <option value="selected">Setores selecionados na escala</option>}{sectors.filter(item => !unit || item.unitId === unit).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="nv-label">Operação<select className="nv-input" value={action} onChange={event => setAction(event.target.value)}><option value="">Todas</option>{Object.entries(scheduleAuditLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="nv-label sm:col-span-2 lg:col-span-3">Plantão<select disabled={Boolean(shiftId)} className="nv-input" value={shiftId || shift} onChange={event => setShift(event.target.value)}>{!shiftId && <option value="">Todos</option>}{shifts.filter(item => item.id === shiftId || (!unit || item.unitId === unit) && (!selectedSectors || selectedSectors.includes(item.sectorId || ''))).map(item => <option key={item.id} value={item.id}>{item.date} · {item.startTime}–{item.endTime} · {sectors.find(sector => sector.id === item.sectorId)?.name || item.sector || 'Plantão'}</option>)}</select></label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}{!data && !error && <p role="status" className="text-sm text-text-muted">Consultando histórico…</p>}
      <ol className="divide-y divide-border">{data?.items.map(entry => <ScheduleHistoryEvent key={entry.id} entry={entry} units={units} sectors={sectors}/>)}</ol>
      {data?.items.length === 0 && <p className="text-sm text-text-muted">Nenhuma alteração neste período ou recorte.</p>}{data?.has_more && <button type="button" disabled={busy} className="nv-button-secondary" onClick={() => void more()}>{busy ? 'Carregando…' : 'Carregar mais alterações'}</button>}
    </div>
  </Dialog>;
}
