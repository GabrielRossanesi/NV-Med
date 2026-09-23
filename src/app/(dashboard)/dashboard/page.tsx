'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  Users,
  Building2,
  Calendar,
  Clock,
  AlertTriangle,
  ChevronRight,
  FileCheck2,
  UserCheck,
  Settings
} from 'lucide-react';
import Link from 'next/link';
import { localDate, sectorCoveragePeriods, shiftTouchesDay } from '@/lib/scheduling';
import { documentIsCritical, documentIsNearExpiry, documentStatusLabels, getDoctorCompliance } from '@/lib/documentCompliance';
import { applicableDocuments, getDocumentGovernance } from '@/lib/documentGovernance';
import { getDoctorOperationalUnitIds } from '@/lib/doctorUnits';

export default function DashboardPage() {
  const { activeOrganizationId, organizations, doctors, units, sectors, shifts, documents } = useStore();

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
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Welcome Heading */}
      <div>
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">
          Painel de Controle
        </h2>
        <p className="text-sm text-text-muted mt-1">
          Balanço geral da operação médica para <span className="font-semibold text-text-secondary">{activeOrg?.name}</span>.
        </p>
      </div>

      {isOrgEmpty ? (
        <div className="bg-card-bg border border-border p-8 rounded-2xl shadow-soft text-center max-w-3xl mx-auto space-y-6 my-8">
          <div className="h-16 w-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="h-8 w-8 animate-pulse" />
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
              <span className="text-[10px] text-text-muted mt-1">Cadastrar primeiro médico</span>
            </Link>

            <Link
              href="/unidades"
              className="flex flex-col items-center p-4 bg-surface-muted border border-border hover:border-primary/45 rounded-xl transition duration-150 text-center cursor-pointer group"
            >
              <Building2 className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition" />
              <span className="text-xs font-bold text-text-primary">Unidades</span>
              <span className="text-[10px] text-text-muted mt-1">Cadastrar primeira unidade</span>
            </Link>

            <Link
              href="/configuracoes"
              className="flex flex-col items-center p-4 bg-surface-muted border border-border hover:border-primary/45 rounded-xl transition duration-150 text-center cursor-pointer group"
            >
              <Settings className="h-6 w-6 text-primary mb-2 group-hover:scale-110 transition" />
              <span className="text-xs font-bold text-text-primary">Configurações</span>
              <span className="text-[10px] text-text-muted mt-1">Ajustar dados da empresa</span>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* KPI Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Doctors */}
            <Link
              href={`/escala?date=${today}`}
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-danger/55 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Furos de cobertura hoje</span>
                <h3 className={`text-2xl font-bold mt-1 ${gapsToday ? 'text-danger' : 'text-success'}`}>{gapsToday}</h3>
                <span className={`text-[10px] font-semibold flex items-center gap-1 mt-1.5 ${gapsToday ? 'text-danger' : 'text-success'}`}>
                  <AlertTriangle className="h-3 w-3" />
                  {gapsToday ? 'Abrir escala e preencher' : 'Cobertura planejada completa'}
                </span>
              </div>
              <div className={`p-2.5 rounded-xl ${gapsToday ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                <Calendar className="h-5 w-5" />
              </div>
            </Link>

            {/* Document Alerts */}
            <Link
              href={`/escala?date=${today}`}
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-warning/55 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Confirmações de hoje</span>
                <h3 className="text-2xl font-bold text-text-primary mt-1">{pendingToday}</h3>
                <span className={`text-[10px] font-semibold flex items-center gap-1 mt-1.5 ${pendingToday ? 'text-warning' : 'text-success'}`}>
                  <Clock className="h-3 w-3" />
                  {pendingToday ? 'Aguardando profissionais' : 'Nenhuma confirmação pendente'}
                </span>
              </div>
              <div className={`p-2.5 rounded-xl ${pendingToday ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                <UserCheck className="h-5 w-5" />
              </div>
            </Link>

            {/* Active Units */}
            <Link
              href="/documentos?status=critical"
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-danger/55 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Pendências documentais</span>
                <h3 className="text-2xl font-bold text-text-primary mt-1">{pendingDocsCount}</h3>
                <span className={`text-[10px] font-semibold flex items-center gap-1 mt-1.5 ${pendingDocsCount ? 'text-danger' : 'text-success'}`}>
                  <FileCheck2 className="h-3 w-3" />
                  {pendingDocsCount ? 'Revisar documentos' : 'Documentação em dia'}
                </span>
              </div>
              <div className={`p-2.5 rounded-xl ${pendingDocsCount ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                <FileCheck2 className="h-5 w-5" />
              </div>
            </Link>

            {/* Month Shifts */}
            <Link
              href="/escala"
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-primary/50 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Estrutura da operação</span>
                <h3 className="text-2xl font-bold text-text-primary mt-1">{totalUnits} <span className="text-sm font-medium text-text-muted">unid.</span> · {orgSectors.length} <span className="text-sm font-medium text-text-muted">set.</span></h3>
                <span className="text-[10px] text-primary font-semibold flex items-center gap-1 mt-1.5 group-hover:underline">
                  <Clock className="h-3 w-3" />
                  {activeDoctors}/{totalDoctors} médicos ativos · {shiftsThisMonth} postos no mês
                </span>
              </div>
              <div className="bg-primary/10 text-primary p-2.5 rounded-xl group-hover:bg-primary group-hover:text-text-inverse transition-colors">
                <Calendar className="h-5 w-5" />
              </div>
            </Link>
          </div>

          {/* Main Operational grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Upcoming Shifts list */}
            <div className="bg-card-bg rounded-xl border border-card-border overflow-hidden lg:col-span-2 flex flex-col justify-between">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Próximos Plantões Escalados</h3>
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
                      open: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400',
                      confirmed: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400',
                      pending: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400',
                      completed: 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400',
                      cancelled: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400',
                    };

                    return (
                      <Link
                        key={shift.id}
                        href={`/escala?date=${shift.date}${shift.doctorId ? `&doctorId=${shift.doctorId}` : ''}`}
                        className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                            {doctor?.name.charAt(4) || 'D'}
                          </div>
                          <div>
                            <p className="font-semibold text-text-secondary group-hover:text-primary transition-colors">{doctor?.name || 'Vaga aberta'}</p>
                            <p className="text-[10px] text-text-muted">{shift.specialty || doctor?.specialty || 'Sem especialidade'} • {unit?.name}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-semibold text-text-secondary">
                              {new Date(shift.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                            </p>
                            <p className="text-[10px] text-text-muted flex items-center gap-0.5 justify-end">
                              <Clock className="h-2.5 w-2.5" />
                              {shift.startTime} - {shift.endTime}
                            </p>
                          </div>

                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusColors[shift.status]}`}>
                            {shift.status === 'open' ? 'Vaga aberta' : shift.status === 'confirmed' ? 'Confirmado' : shift.status === 'pending' ? 'Pendente' : shift.status === 'cancelled' ? 'Cancelado' : 'Concluído'}
                          </span>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-text-muted">
                    Nenhum plantão agendado nos próximos dias.
                  </div>
                )}
              </div>
            </div>

            {/* Unit Breakdown */}
            <div className="bg-card-bg rounded-xl border border-card-border p-5">
              <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4">Plantões por Unidade no Mês</h3>
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
                      <p className="text-[10px] text-text-muted">Conformidade documental: <span className={ub.compliance === 100 ? 'font-semibold text-success' : 'font-semibold text-warning'}>{ub.compliance}%</span></p>
                      <div className="h-2 w-full bg-surface-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Document workflow */}
            <div className="overflow-hidden rounded-xl border border-card-border bg-card-bg lg:col-span-2">
              <div className="flex flex-col gap-4 border-b border-border p-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-text-primary">Esteira documental</h3>
                  <p className="mt-1 text-xs text-text-muted">Pendências por etapa, do envio até a regularização.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Unidade<select value={documentUnitFilter} onChange={event => setDocumentUnitFilter(event.target.value)} className="mt-1 block min-w-40 rounded-lg border border-border bg-input-bg px-2.5 py-2 text-xs normal-case text-text-primary"><option value="">Todas</option>{orgUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Especialidade<select value={documentSpecialtyFilter} onChange={event => setDocumentSpecialtyFilter(event.target.value)} className="mt-1 block min-w-40 rounded-lg border border-border bg-input-bg px-2.5 py-2 text-xs normal-case text-text-primary"><option value="">Todas</option>{[...new Set(orgDoctors.map(doctor => doctor.specialty))].map(item => <option key={item} value={item}>{item}</option>)}</select></label>
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
            </div>

            {/* Specialty Breakdown */}
            <div className="bg-card-bg rounded-xl border border-card-border p-5">
              <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4">Corpo Clínico por Especialidade</h3>
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
                    <span className="text-right"><span className="block font-bold text-text-primary">{sb.count}</span><span className={`text-[9px] ${sb.compliance === 100 ? 'text-success' : 'text-warning'}`}>{sb.compliance}% regular</span></span>
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
    </div>
  );
}
