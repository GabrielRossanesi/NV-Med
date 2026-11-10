'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  Users,
  Building2,
  Calendar,
  Clock,
  ArrowUpRight,
  ChevronRight,
  FileCheck2,
  UserCheck,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { localDate, sectorCoveragePeriods, shiftTouchesDay } from '@/lib/scheduling';
import { documentIsCritical, documentIsNearExpiry, documentStatusLabels, getDoctorCompliance } from '@/lib/documentCompliance';
import { applicableDocuments, getDocumentGovernance } from '@/lib/documentGovernance';
import { getDoctorOperationalUnitIds } from '@/lib/doctorUnits';
import OperationalIndicators from '@/components/OperationalIndicators';
import NotificationInbox from '@/components/NotificationInbox';
import UserAvatar from '@/components/UserAvatar';
import { canViewPermission } from '@/lib/permissions';

type MetricProps = {
  href: string;
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: LucideIcon;
  tone: string;
  highlight?: boolean;
};

function DashboardMetric({ href, label, value, detail, icon: Icon, tone, highlight }: MetricProps) {
  return (
    <Link href={href} className={`nv-panel group flex flex-col gap-3 p-4 transition-shadow hover:shadow-medium motion-reduce:transition-none sm:p-5 ${highlight ? 'border-t-2 border-t-primary' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-grid size-9 shrink-0 place-items-center rounded-xl bg-current/10 ${tone}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <ArrowUpRight size={16} className="shrink-0 text-text-muted group-hover:text-primary" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        <p className="mt-1 text-3xl font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      </div>
      <p className={`mt-auto text-xs font-medium leading-relaxed ${tone}`}>{detail}</p>
    </Link>
  );
}

export default function DashboardPage() {
  const { activeOrganizationId, organizations, doctors, units, sectors, shifts, documents, currentUser } = useStore();
  const canSeeDocuments = canViewPermission(currentUser, 'documentos');

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const [documentUnitFilter, setDocumentUnitFilter] = useState('');
  const [documentSpecialtyFilter, setDocumentSpecialtyFilter] = useState('');
  const [documentReferenceTime] = useState(() => Date.now());

  // Filter lists by active organization
  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId);
  const orgUnits = units.filter((u) => u.organizationId === activeOrganizationId);
  const orgShifts = shifts.filter((s) => s.organizationId === activeOrganizationId);
  const orgSectors = sectors.filter((s) => s.organizationId === activeOrganizationId && s.status === 'active');
  const orgDocs = documents.filter((d) => d.organizationId === activeOrganizationId);
  const documentGovernance = getDocumentGovernance(activeOrg);
  const requirements = activeOrg?.settings.requiredDocuments || [];
  const maxAlertDays = Math.max(...documentGovernance.expiryAlertDays);
  const operationalDoctors = new Map(orgDoctors.map(doctor => [doctor.id, { ...doctor, linkedUnits: getDoctorOperationalUnitIds(orgShifts, doctor.id) }]));
  const applicableDocumentIds = new Set(orgDoctors.flatMap(doctor => applicableDocuments(operationalDoctors.get(doctor.id) || doctor, orgDocs, requirements).map(document => document.id)));
  const effectiveDocs = orgDocs.filter(document => applicableDocumentIds.has(document.id));
  const doctorCompliance = new Map(orgDoctors.map(doctor => [doctor.id, getDoctorCompliance(operationalDoctors.get(doctor.id) || doctor, orgDocs, documentReferenceTime, requirements, maxAlertDays)]));

  // Compute metrics
  const totalDoctors = orgDoctors.length;
  const activeDoctors = orgDoctors.filter((d) => d.status === 'active').length;
  const pendingDocsCount = effectiveDocs.filter((document) => document.status !== 'approved' || documentIsCritical(document, documentReferenceTime) || documentIsNearExpiry(document, documentReferenceTime, maxAlertDays)).length;
  const totalUnits = orgUnits.length;
  
  const today = localDate();
  const month = today.slice(0, 7);
  const shiftsThisMonth = orgShifts.filter((s) => s.date.includes(month)).length;
  const pendingToday = orgShifts.filter((s) => shiftTouchesDay(s, today) && s.status === 'pending').length;
  const gapsToday = orgSectors.reduce((total, sector) => {
    const filled = orgShifts.filter((shift) => shift.sectorId === sector.id && shift.date === today && shift.doctorId && shift.status !== 'cancelled').length;
    const required = sectorCoveragePeriods(sector).reduce((sum, period) => sum + period.requiredDoctors, 0);
    return total + Math.max(required - filled, 0);
  }, 0);

  // Upcoming shifts sorted from the user's current local day.
  const upcomingShifts = [...orgShifts]
    .filter((s) => s.date >= today && s.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .slice(0, 5);

  const pendingDocumentItems = effectiveDocs
    .filter((document) => document.status !== 'approved' || documentIsCritical(document, documentReferenceTime) || documentIsNearExpiry(document, documentReferenceTime, maxAlertDays))
    .sort((a, b) => {
      const priority = { expired: 0, rejected: 1, not_sent: 2, sent: 3, analyzing: 4, approved: 5 };
      return priority[a.status] - priority[b.status];
    });
  const filteredPendingDocumentItems = pendingDocumentItems.filter(document => {
    const doctor = orgDoctors.find(item => item.id === document.doctorId);
    const operationalDoctor = doctor ? operationalDoctors.get(doctor.id) : null;
    return doctor && (!documentUnitFilter || operationalDoctor?.linkedUnits.includes(documentUnitFilter)) && (!documentSpecialtyFilter || doctor.specialty === documentSpecialtyFilter);
  });
  const documentStages = [
    { label: 'Envio pendente', status: 'not_sent', count: filteredPendingDocumentItems.filter((item) => item.status === 'not_sent').length },
    { label: 'Em conferência', status: 'review', count: filteredPendingDocumentItems.filter((item) => item.status === 'sent' || item.status === 'analyzing').length },
    { label: 'Ação necessária', status: 'critical', count: filteredPendingDocumentItems.filter((item) => documentIsCritical(item, documentReferenceTime) || documentIsNearExpiry(item, documentReferenceTime, maxAlertDays)).length },
  ];

  // Specialties breakdown (doctors per specialty)
  const specialtiesBreakdown = activeOrg?.settings.specialties
    .map((spec) => {
      const count = orgDoctors.filter((d) => d.specialty === spec).length;
      const regular = orgDoctors.filter(doctor => doctor.specialty === spec && doctorCompliance.get(doctor.id)?.compliant).length;
      return { name: spec, count, compliance: count ? Math.round((regular / count) * 100) : 0 };
    })
    .sort((a, b) => b.count - a.count) || [];

  // Units breakdown (shifts per unit for the current month)
  const unitsBreakdown = orgUnits
    .map((unit) => {
      const count = orgShifts.filter((s) => s.unitId === unit.id && s.date.includes(month)).length;
      const linkedDoctors = orgDoctors.filter(doctor => operationalDoctors.get(doctor.id)?.linkedUnits.includes(unit.id));
      const regular = linkedDoctors.filter(doctor => doctorCompliance.get(doctor.id)?.compliant).length;
      return { name: unit.name, count, compliance: linkedDoctors.length ? Math.round((regular / linkedDoctors.length) * 100) : 0 };
    })
    .sort((a, b) => b.count - a.count) || [];

  const isOrgEmpty = orgDoctors.length === 0 && orgUnits.length === 0;

  return (
    <div className="space-y-6 lg:space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="nv-page-title">Painel de controle</h1>
          <p className="mt-2 text-sm text-text-muted">
            Balanço geral da operação médica{activeOrg && <> para <span className="font-medium text-text-secondary">{activeOrg.name}</span></>}.
          </p>
        </div>
        <time dateTime={today} className="nv-badge gap-2 px-3 py-2">
          <Calendar size={15} className="text-accent" aria-hidden="true" />
          {new Date(today + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </time>
      </header>

      {isOrgEmpty ? (
        <div className="nv-panel space-y-5 p-5 text-center sm:p-8">
          <div className="h-16 w-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-text-primary">Bem-vindo ao NV Med!</h3>
            <p className="text-sm text-text-muted mt-2 max-w-md mx-auto">
              Para começar a gerenciar o corpo clínico, as escalas de plantões e a conformidade de documentos, cadastre os primeiros elementos da sua empresa.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <Link
              href="/medicos"
              className="flex flex-col items-center p-4 bg-surface-muted border border-border hover:border-primary/45 rounded-xl transition duration-150 text-center cursor-pointer group"
            >
              <Users className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition" />
              <span className="text-xs font-bold text-text-primary">Corpo Clínico</span>
              <span className="text-xs text-text-muted mt-1">Cadastrar primeiro médico</span>
            </Link>

            <Link
              href="/unidades"
              className="flex flex-col items-center p-4 bg-surface-muted border border-border hover:border-primary/45 rounded-xl transition duration-150 text-center cursor-pointer group"
            >
              <Building2 className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition" />
              <span className="text-xs font-bold text-text-primary">Unidades</span>
              <span className="text-xs text-text-muted mt-1">Cadastrar primeira unidade</span>
            </Link>

            <Link
              href="/configuracoes"
              className="flex flex-col items-center p-4 bg-surface-muted border border-border hover:border-primary/45 rounded-xl transition duration-150 text-center cursor-pointer group"
            >
              <Settings className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition" />
              <span className="text-xs font-bold text-text-primary">Configurações</span>
              <span className="text-xs text-text-muted mt-1">Ajustar dados da empresa</span>
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section aria-label="Indicadores da operação" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 sm:gap-4">
            <DashboardMetric
              href={`/escala?date=${today}`}
              label="Furos de cobertura hoje"
              value={gapsToday}
              detail={gapsToday ? 'Abrir escala e preencher' : 'Cobertura planejada completa'}
              icon={Calendar}
              tone={gapsToday ? 'text-danger' : 'text-success'}
              highlight
            />
            <DashboardMetric
              href={`/escala?date=${today}`}
              label="Confirmações de hoje"
              value={pendingToday}
              detail={pendingToday ? 'Aguardando profissionais' : 'Nenhuma confirmação pendente'}
              icon={UserCheck}
              tone={pendingToday ? 'text-warning' : 'text-success'}
            />
            {canSeeDocuments && (
              <DashboardMetric
                href="/documentos?status=critical"
                label="Pendências documentais"
                value={pendingDocsCount}
                detail={pendingDocsCount ? 'Revisar documentos' : 'Documentação em dia'}
                icon={FileCheck2}
                tone={pendingDocsCount ? 'text-danger' : 'text-success'}
              />
            )}
            <DashboardMetric
              href="/escala"
              label="Estrutura da operação"
              value={<>{totalUnits} <span className="text-sm font-medium text-text-muted">unid.</span> · {orgSectors.length} <span className="text-sm font-medium text-text-muted">set.</span></>}
              detail={`${activeDoctors}/${totalDoctors} médicos ativos · ${shiftsThisMonth} postos no mês`}
              icon={Building2}
              tone="text-primary"
            />
          </section>

          {/* Main Operational grid */}
          <div className="grid gap-5 xl:grid-cols-3">
            
            {/* Upcoming Shifts list */}
            <div className="nv-panel overflow-hidden xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4 sm:px-5">
                <h3 className="nv-section-title">Próximos plantões escalados</h3>
                <Link href="/escala" className="text-xs text-primary font-semibold hover:underline flex items-center gap-0.5">
                  Ver escala completa <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="divide-y divide-border">
                {upcomingShifts.length > 0 ? (
                  upcomingShifts.map((shift) => {
                    const doctor = orgDoctors.find((d) => d.id === shift.doctorId);
                    const unit = orgUnits.find((u) => u.id === shift.unitId);

                    const statusColors = {
                      open: 'bg-warning/10 text-warning',
                      confirmed: 'bg-success/10 text-success',
                      pending: 'bg-warning/10 text-warning',
                      completed: 'bg-info/10 text-info',
                      cancelled: 'bg-danger/10 text-danger',
                    };

                    return (
                      <Link
                        key={shift.id}
                        href={`/escala?date=${shift.date}${shift.doctorId ? `&doctorId=${shift.doctorId}` : ''}`}
                        className="group flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm transition-colors hover:bg-table-row-hover focus-visible:outline-offset-[-3px] sm:px-5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {doctor ? <UserAvatar name={doctor.name} /> : (
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warning/10 text-warning">
                              <Calendar size={16} aria-hidden="true" />
                            </span>
                          )}
                          <div>
                            <p className="font-semibold text-text-secondary group-hover:text-primary transition-colors">{doctor?.name || 'Vaga aberta'}</p>
                            <p className="text-xs text-text-muted">{shift.specialty || doctor?.specialty || 'Sem especialidade'} • {unit?.name}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <div className="tabular-nums sm:text-right">
                            <p className="font-semibold text-text-secondary">
                              {new Date(shift.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            </p>
                            <p className="flex items-center gap-1 text-xs text-text-muted sm:justify-end">
                              <Clock className="h-2.5 w-2.5" />
                              {shift.startTime} - {shift.endTime}
                            </p>
                          </div>

                          <span className={`nv-badge ${statusColors[shift.status]}`}>
                            {shift.status === 'open' ? 'Vaga aberta' : shift.status === 'confirmed' ? 'Confirmado' : shift.status === 'pending' ? 'Pendente' : shift.status === 'cancelled' ? 'Cancelado' : 'Concluído'}
                          </span>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="nv-empty m-4">
                    Nenhum plantão agendado nos próximos dias.
                  </div>
                )}
              </div>
            </div>

            {/* Unit Breakdown */}
            <div className="nv-panel p-4 sm:p-5">
              <h3 className="nv-section-title mb-4">Plantões por unidade no mês</h3>
              <div className="space-y-2">
                {unitsBreakdown.map((ub) => {
                  const total = shiftsThisMonth || 1;
                  const percentage = Math.round((ub.count / total) * 100);
                  const unit = orgUnits.find((u) => u.name === ub.name);
                  return (
                    <Link
                      key={ub.name}
                      href={unit ? `/escala?unitId=${unit.id}` : '/escala'}
                      className="block space-y-1 p-2.5 rounded-xl hover:bg-slate-50/50 dark:hover:bg-slate-800/10 border border-transparent hover:border-border transition-all cursor-pointer group"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-text-secondary truncate pr-4 group-hover:text-primary transition-colors">{ub.name}</span>
                        <span className="font-bold text-text-primary flex-shrink-0">{ub.count} plantões ({percentage}%)</span>
                      </div>
                      {canSeeDocuments && <p className="text-xs text-text-muted">Conformidade documental · <span className={ub.compliance === 100 ? 'font-semibold text-success' : 'font-semibold text-warning'}>{ub.compliance}%</span></p>}
                      <div className="h-2 w-full bg-surface-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
                {unitsBreakdown.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-8">Nenhum plantão registrado este mês.</p>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Operational grid */}
          <div className="grid gap-5 xl:grid-cols-3">
            
            {/* Document workflow */}
            {canSeeDocuments && <div className="nv-panel overflow-hidden xl:col-span-2">
              <div className="flex flex-col gap-4 border-b border-border p-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="nv-section-title">Esteira documental</h3>
                  <p className="mt-1 text-xs text-text-muted">Pendências por etapa, do envio até a regularização.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Unidade<select value={documentUnitFilter} onChange={event => setDocumentUnitFilter(event.target.value)} className="nv-input mt-1 block min-w-32 normal-case"><option value="">Todas</option>{orgUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Especialidade<select value={documentSpecialtyFilter} onChange={event => setDocumentSpecialtyFilter(event.target.value)} className="nv-input mt-1 block min-w-32 normal-case"><option value="">Todas</option>{[...new Set(orgDoctors.map(doctor => doctor.specialty))].map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                  <Link href={`/medicos?documentStatus=pending${documentUnitFilter ? `&unitId=${documentUnitFilter}` : ''}${documentSpecialtyFilter ? `&specialty=${encodeURIComponent(documentSpecialtyFilter)}` : ''}`} className="mb-0.5 flex items-center gap-0.5 px-2 py-2 text-xs font-semibold text-primary hover:underline">Ver corpo clínico <ChevronRight className="h-3.5 w-3.5" /></Link>
                </div>
              </div>

              <div className="grid grid-cols-3 border-b border-border">
                {documentStages.map((stage, index) => (
                  <Link key={stage.label} href={`/documentos?status=${stage.status}`} className={`relative p-4 transition hover:bg-state-hover ${index ? 'border-l border-border' : ''}`}>
                    <span className={`text-2xl font-semibold tabular-nums ${stage.status === 'critical' && stage.count ? 'text-danger' : 'text-text-primary'}`}>{stage.count}</span>
                    <span className="mt-1 block text-[11px] font-medium text-text-muted">{stage.label}</span>
                    {stage.count > 0 && <span className={`absolute bottom-0 left-0 h-0.5 ${stage.status === 'critical' ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${Math.min(100, 24 + stage.count * 12)}%` }} />}
                  </Link>
                ))}
              </div>

              <div className="flex gap-3 overflow-x-auto p-4">
                {filteredPendingDocumentItems.slice(0, 8).map((document) => {
                  const doctor = orgDoctors.find((item) => item.id === document.doctorId);
                  const critical = documentIsCritical(document, documentReferenceTime);
                  const nearExpiry = documentIsNearExpiry(document, documentReferenceTime, maxAlertDays);
                  return (
                    <Link key={document.id} href={`/documentos/${document.doctorId}`} className="min-w-[220px] border-l-2 border-border px-3 py-1 transition hover:border-primary">
                      <p className="truncate text-xs font-semibold text-text-primary">{doctor?.name || 'Médico'}</p>
                      <p className="mt-1 truncate text-[11px] text-text-muted">{document.name}</p>
                      <p className={`mt-2 text-[10px] font-semibold uppercase tracking-wider ${critical ? 'text-danger' : nearExpiry ? 'text-warning' : 'text-primary'}`}>{nearExpiry ? 'Vence em breve' : documentStatusLabels[document.status]}</p>
                    </Link>
                  );
                })}
                {!filteredPendingDocumentItems.length && <p className="w-full py-4 text-center text-xs text-success">Nenhuma pendência para os filtros selecionados.</p>}
              </div>
            </div>}

            {/* Specialty Breakdown */}
            <div className="nv-panel p-4 sm:p-5">
              <h3 className="nv-section-title mb-4">Corpo clínico por especialidade</h3>
              <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                {specialtiesBreakdown.map((sb) => (
                  <Link
                    key={sb.name}
                    href={`/medicos?specialty=${sb.name}`}
                    className="flex items-center justify-between text-xs p-2 rounded-lg hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors group/spec cursor-pointer border border-transparent hover:border-border"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-primary group-hover/spec:scale-125 transition-transform" />
                      <span className="font-medium text-text-secondary group-hover/spec:text-primary dark:group-hover/spec:text-primary transition-colors">{sb.name}</span>
                    </div>
                    <span className="text-right"><span className="block font-bold text-text-primary">{sb.count}</span>{canSeeDocuments && <span className={`text-[9px] ${sb.compliance === 100 ? 'text-success' : 'text-warning'}`}>{sb.compliance}% regular</span>}</span>
                  </Link>
                ))}
                {specialtiesBreakdown.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-4">Nenhuma especialidade registrada.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <OperationalIndicators key={activeOrganizationId} organization={activeOrganizationId} />
      <NotificationInbox />
    </div>
  );
}
