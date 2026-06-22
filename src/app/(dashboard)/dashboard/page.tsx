'use client';

import { useStore } from '@/store/useStore';
import {
  Users,
  Building2,
  Calendar,
  Clock,
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  FileCheck2,
  UserCheck
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
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-text-inverse transition-colors duration-200">
            <Users className="h-5 w-5" />
          </div>
        </Link>

        {/* Pending Docs */}
        <Link
          href="/documentos?status=critical"
          className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-medium group"
        >
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Pendências Documentais</span>
            <h3 className={`text-2xl font-bold mt-1 ${pendingDocsCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-text-primary'}`}>{pendingDocsCount}</h3>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1 mt-1.5 group-hover:underline">
              <FileCheck2 className="h-3 w-3" />
              {pendingDocsCount > 0 ? 'Resolver pendências' : 'Tudo regularizado'}
            </span>
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center transition-colors duration-200 ${pendingDocsCount > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:bg-amber-500 group-hover:text-text-inverse' : 'bg-surface-muted text-text-muted group-hover:bg-text-muted group-hover:text-text-inverse'}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
        </Link>

        {/* Units */}
        <Link
          href="/unidades?status=active"
          className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-primary/50 hover:shadow-medium group"
        >
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Unidades Ativas</span>
            <h3 className="text-2xl font-bold text-text-primary mt-1">{totalUnits}</h3>
            <span className="text-[10px] text-text-muted font-semibold flex items-center gap-1 mt-1.5 group-hover:underline">
              <Building2 className="h-3 w-3" />
              Gerenciar unidades
            </span>
          </div>
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-text-inverse transition-colors duration-200">
            <Building2 className="h-5 w-5" />
          </div>
        </Link>

        {/* Monthly Shifts */}
        <Link
          href="/escala"
          className="bg-card-bg p-5 rounded-xl border border-card-border flex items-center justify-between transition-all duration-250 cursor-pointer hover:border-primary/50 hover:shadow-medium group"
        >
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">Plantões do Mês</span>
            <h3 className="text-2xl font-bold text-text-primary mt-1">{shiftsThisMonth}</h3>
            <span className="text-[10px] text-primary font-semibold flex items-center gap-1 mt-1.5 group-hover:underline">
              <TrendingUp className="h-3 w-3" />
              {shiftsToday} hoje • Abrir escala
            </span>
          </div>
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-text-inverse transition-colors duration-200">
            <Calendar className="h-5 w-5" />
          </div>
        </Link>
      </div>

      {/* Main Section Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Columns (Upcoming Shifts + Unit summary) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Upcoming Shifts */}
          <div className="bg-card-bg rounded-xl border border-card-border overflow-hidden">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Próximos Plantões</h3>
                <p className="text-[11px] text-text-muted">Plantões agendados a partir de hoje</p>
              </div>
              <Link href="/escala" className="text-xs font-semibold text-primary flex items-center gap-0.5 hover:underline">
                Escala completa
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            
            <div className="divide-y divide-border">
              {upcomingShifts.length > 0 ? (
                upcomingShifts.map((shift) => {
                  const doctor = orgDoctors.find((d) => d.id === shift.doctorId);
                  const unit = orgUnits.find((u) => u.id === shift.unitId);
                  
                  // Status badge style
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
                <p className="text-xs text-text-muted text-center py-4">Nenhuma unidade com plantão agendado.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Alerts + Specialties) */}
        <div className="space-y-8">
          {/* Compliance Alerts */}
          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-3">Pendências Críticas</h3>
            <p className="text-[11px] text-text-muted mb-4">Médicos com documentação irregular</p>

            <div className="space-y-3">
              {doctorsWithAlerts.length > 0 ? (
                doctorsWithAlerts.map((doc) => {
                  const urgentCount = doc.alerts.filter((a) => a.status === 'expired' || a.status === 'rejected').length;
                  return (
                    <Link
                      key={doc.id}
                      href={`/documentos?doctorId=${doc.id}`}
                      className="block p-3 rounded-xl bg-background border border-border hover:border-amber-400 dark:hover:border-amber-450 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all duration-150 cursor-pointer shadow-sm hover:shadow-md group"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-text-secondary truncate group-hover:text-primary transition-colors">{doc.name}</p>
                          <p className="text-[10px] text-text-muted mt-0.5">CRM {doc.crm}-{doc.crmUf} • {doc.specialty}</p>
                        </div>
                        {urgentCount > 0 ? (
                          <span className="flex-shrink-0 text-[9px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                            Crítico
                          </span>
                        ) : (
                          <span className="flex-shrink-0 text-[9px] bg-amber-500/10 text-amber-600 dark:text-amber-450 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                            Análise
                          </span>
                        )}
                      </div>
                      
                      {/* Sub checklist warning details */}
                      <div className="mt-2 text-[10px] text-amber-600 dark:text-amber-400 flex flex-wrap gap-x-2 gap-y-0.5">
                        {doc.alerts.slice(0, 2).map((alert) => (
                          <span key={alert.id} className="flex items-center gap-0.5">
                            • {alert.name} ({alert.status === 'expired' ? 'Vencido' : alert.status === 'rejected' ? 'Reprovado' : 'Em Análise'})
                          </span>
                        ))}
                        {doc.alerts.length > 2 && (
                          <span>e mais {doc.alerts.length - 2}</span>
                        )}
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="py-6 text-center text-text-muted text-xs">
                  Sem irregularidades críticas de documentação.
                </div>
              )}
            </div>
          </div>

          {/* Specialties Summary */}
          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4">Corpo Clínico por Especialidade</h3>
            <div className="divide-y divide-border">
              {specialtiesBreakdown.map((sb) => (
                <Link
                  key={sb.name}
                  href={`/medicos?specialty=${encodeURIComponent(sb.name)}`}
                  className="py-2.5 flex items-center justify-between text-xs first:pt-0 last:pb-0 group/spec hover:bg-slate-50 dark:hover:bg-slate-800/20 px-1 rounded transition cursor-pointer"
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

      </div>
    </div>
  );
}
