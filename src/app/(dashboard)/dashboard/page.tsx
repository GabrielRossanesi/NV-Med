'use client';

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

export default function DashboardPage() {
  const { activeOrganizationId, organizations, doctors, units, shifts, documents } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];

  // Filter lists by active organization
  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId);
  const orgUnits = units.filter((u) => u.organizationId === activeOrganizationId);
  const orgShifts = shifts.filter((s) => s.organizationId === activeOrganizationId);
  const orgDocs = documents.filter((d) => d.organizationId === activeOrganizationId);

  // Compute metrics
  const totalDoctors = orgDoctors.length;
  const activeDoctors = orgDoctors.filter((d) => d.status === 'active').length;
  const pendingDocsCount = orgDocs.filter(
    (d) => d.status === 'analyzing' || d.status === 'expired' || d.status === 'rejected'
  ).length;
  const totalUnits = orgUnits.length;
  
  // June 2026 is current month in mockData
  const shiftsThisMonth = orgShifts.filter((s) => s.date.includes('2026-06')).length;
  const shiftsToday = orgShifts.filter((s) => s.date === '2026-06-21').length;

  // Upcoming shifts (sorted by date/time from today 2026-06-21)
  const upcomingShifts = [...orgShifts]
    .filter((s) => s.date >= '2026-06-21' && s.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .slice(0, 5);

  // Doctors with pending documents
  const doctorsWithAlerts = orgDoctors
    .map((doc) => {
      const docAlerts = orgDocs.filter(
        (d) => d.doctorId === doc.id && (d.status === 'analyzing' || d.status === 'expired' || d.status === 'rejected')
      );
      return {
        ...doc,
        alerts: docAlerts
      };
    })
    .filter((d) => d.alerts.length > 0)
    .slice(0, 4);

  // Specialties breakdown (doctors per specialty)
  const specialtiesBreakdown = activeOrg?.settings.specialties
    .map((spec) => {
      const count = orgDoctors.filter((d) => d.specialty === spec).length;
      return { name: spec, count };
    })
    .sort((a, b) => b.count - a.count) || [];

  // Units breakdown (shifts per unit for the current month)
  const unitsBreakdown = orgUnits
    .map((unit) => {
      const count = orgShifts.filter((s) => s.unitId === unit.id && s.date.includes('2026-06')).length;
      return { name: unit.name, count };
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
              href="/medicos"
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-primary/50 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Corpo Clínico</span>
                <h3 className="text-2xl font-bold text-text-primary mt-1">{totalDoctors}</h3>
                <span className="text-[10px] text-primary font-semibold flex items-center gap-1 mt-1.5 group-hover:underline">
                  <UserCheck className="h-3 w-3" />
                  {activeDoctors} ativos • Ver médicos
                </span>
              </div>
              <div className="bg-primary/10 text-primary p-2.5 rounded-xl group-hover:bg-primary group-hover:text-text-inverse transition-colors">
                <Users className="h-5 w-5" />
              </div>
            </Link>

            {/* Document Alerts */}
            <Link
              href="/documentos?status=critical"
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-danger/55 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Pendências Documentais</span>
                <h3 className="text-2xl font-bold text-text-primary mt-1">{pendingDocsCount}</h3>
                <span className={`text-[10px] font-semibold flex items-center gap-1 mt-1.5 ${pendingDocsCount > 0 ? 'text-danger group-hover:underline' : 'text-text-muted'}`}>
                  <AlertTriangle className="h-3 w-3" />
                  {pendingDocsCount > 0 ? 'Exige atenção • Resolver pendências' : 'Conformidade 100%'}
                </span>
              </div>
              <div className={`p-2.5 rounded-xl transition-colors ${pendingDocsCount > 0 ? 'bg-danger/10 text-danger group-hover:bg-danger group-hover:text-text-inverse' : 'bg-surface-muted text-text-muted'}`}>
                <FileCheck2 className="h-5 w-5" />
              </div>
            </Link>

            {/* Active Units */}
            <Link
              href="/unidades?status=active"
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-primary/50 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Unidades Ativas</span>
                <h3 className="text-2xl font-bold text-text-primary mt-1">{totalUnits}</h3>
                <span className="text-[10px] text-primary font-semibold flex items-center gap-1 mt-1.5 group-hover:underline">
                  <Building2 className="h-3 w-3" />
                  Gerenciar unidades
                </span>
              </div>
              <div className="bg-primary/10 text-primary p-2.5 rounded-xl group-hover:bg-primary group-hover:text-text-inverse transition-colors">
                <Building2 className="h-5 w-5" />
              </div>
            </Link>

            {/* Month Shifts */}
            <Link
              href="/escala"
              className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-primary/50 hover:shadow-medium group"
            >
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Plantões do Mês</span>
                <h3 className="text-2xl font-bold text-text-primary mt-1">{shiftsThisMonth}</h3>
                <span className="text-[10px] text-primary font-semibold flex items-center gap-1 mt-1.5 group-hover:underline">
                  <Clock className="h-3 w-3" />
                  {shiftsToday} hoje • Abrir escala
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
                      confirmed: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400',
                      pending: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400',
                      completed: 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400',
                      cancelled: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400',
                    };

                    return (
                      <Link
                        key={shift.id}
                        href={`/escala?date=${shift.date}&doctorId=${shift.doctorId}`}
                        className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                            {doctor?.name.charAt(4) || 'D'}
                          </div>
                          <div>
                            <p className="font-semibold text-text-secondary group-hover:text-primary transition-colors">{doctor?.name}</p>
                            <p className="text-[10px] text-text-muted">{doctor?.specialty} • {unit?.name}</p>
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
                            {shift.status === 'confirmed' ? 'Confirmado' : shift.status === 'pending' ? 'Pendente' : 'Concluído'}
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
            
            {/* Physicians with Document Alerts */}
            <div className="bg-card-bg rounded-xl border border-card-border p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Médicos com Documentação Irregular</h3>
                <Link href="/documentos?status=critical" className="text-xs text-primary font-semibold hover:underline flex items-center gap-0.5">
                  Ver pendências <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <div className="space-y-3">
                {doctorsWithAlerts.length > 0 ? (
                  doctorsWithAlerts.map((doc) => {
                    const expiredCount = doc.alerts.filter((d) => d.status === 'expired').length;
                    const rejectedCount = doc.alerts.filter((d) => d.status === 'rejected').length;
                    const analyzingCount = doc.alerts.filter((d) => d.status === 'analyzing' || d.status === 'sent').length;

                    return (
                      <Link
                        key={doc.id}
                        href={`/documentos?doctorId=${doc.id}`}
                        className="flex items-center justify-between p-3 bg-surface-muted/50 border border-border hover:border-primary/30 rounded-xl transition duration-150 group cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                            {doc.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-text-primary group-hover:text-primary transition-colors">{doc.name}</p>
                            <p className="text-[10px] text-text-muted">{doc.specialty} • CRM {doc.crm}-{doc.crmUf}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {expiredCount > 0 && (
                            <span className="px-2 py-0.5 bg-red-500/10 text-red-650 dark:text-red-400 rounded text-[9px] font-bold">
                              {expiredCount} Vencido{expiredCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {rejectedCount > 0 && (
                            <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-500 rounded text-[9px] font-bold">
                              {rejectedCount} Reprovado{rejectedCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {analyzingCount > 0 && (
                            <span className="px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded text-[9px] font-bold">
                              {analyzingCount} Em Análise
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="text-center py-6 text-xs text-text-muted bg-surface-muted rounded-xl border border-dashed border-border">
                    Não há médicos com pendências documentais ativas.
                  </div>
                )}
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
                    <span className="font-bold text-text-primary bg-surface-muted px-2 py-0.5 rounded group-hover/spec:bg-primary/10 group-hover/spec:text-primary dark:group-hover/spec:text-primary transition-colors">
                      {sb.count}
                    </span>
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
