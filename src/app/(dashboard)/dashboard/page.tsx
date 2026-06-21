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

  // Units breakdown (shifts per unit)
  const unitsBreakdown = orgUnits
    .map((unit) => {
      const count = orgShifts.filter((s) => s.unitId === unit.id).length;
      return { name: unit.name, count };
    })
    .sort((a, b) => b.count - a.count) || [];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Welcome Heading */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
          Painel de Controle
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Balanço geral da operação médica para <span className="font-semibold text-slate-800 dark:text-slate-200">{activeOrg?.name}</span>.
        </p>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Doctors */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between transition-glow">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Médicos Cadastrados</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalDoctors}</h3>
            <span className="text-[10px] text-teal-600 dark:text-teal-400 font-medium flex items-center gap-1 mt-1.5">
              <UserCheck className="h-3 w-3" />
              {activeDoctors} ativos no momento
            </span>
          </div>
          <div className="h-10 w-10 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center">
            <Users className="h-5 w-5" />
          </div>
        </div>

        {/* Pending Docs */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between transition-glow">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Alertas de Documento</span>
            <h3 className={`text-2xl font-bold mt-1 ${pendingDocsCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{pendingDocsCount}</h3>
            <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-1.5">
              <FileCheck2 className="h-3 w-3" />
              Exige verificação e CRM
            </span>
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${pendingDocsCount > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>

        {/* Units */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between transition-glow">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Unidades Ativas</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalUnits}</h3>
            <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-1.5">
              <Building2 className="h-3 w-3" />
              Hospitais, UPA e Clínicas
            </span>
          </div>
          <div className="h-10 w-10 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center">
            <Building2 className="h-5 w-5" />
          </div>
        </div>

        {/* Monthly Shifts */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between transition-glow">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Plantões do Mês</span>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{shiftsThisMonth}</h3>
            <span className="text-[10px] text-teal-600 dark:text-teal-400 font-medium flex items-center gap-1 mt-1.5">
              <TrendingUp className="h-3 w-3" />
              {shiftsToday} agendados para hoje
            </span>
          </div>
          <div className="h-10 w-10 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center">
            <Calendar className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Main Section Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Columns (Upcoming Shifts + Unit summary) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Upcoming Shifts */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider">Próximos Plantões</h3>
                <p className="text-[11px] text-slate-400">Plantões agendados a partir de hoje</p>
              </div>
              <Link href="/escala" className="text-xs font-semibold text-teal-600 dark:text-teal-400 flex items-center gap-0.5 hover:underline">
                Escala completa
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
                    <div key={shift.id} className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
                          {doctor?.name.charAt(4) || 'D'}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{doctor?.name}</p>
                          <p className="text-[10px] text-slate-400">{doctor?.specialty} • {unit?.name}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-semibold text-slate-700 dark:text-slate-300">
                            {new Date(shift.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                          </p>
                          <p className="text-[10px] text-slate-400 flex items-center gap-0.5 justify-end">
                            <Clock className="h-2.5 w-2.5" />
                            {shift.startTime} - {shift.endTime}
                          </p>
                        </div>

                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusColors[shift.status]}`}>
                          {shift.status === 'confirmed' ? 'Confirmado' : shift.status === 'pending' ? 'Pendente' : 'Concluído'}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-400">
                  Nenhum plantão agendado nos próximos dias.
                </div>
              )}
            </div>
          </div>

          {/* Unit Breakdown */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-4">Plantões por Unidade</h3>
            <div className="space-y-3.5">
              {unitsBreakdown.map((ub) => {
                const total = orgShifts.length || 1;
                const percentage = Math.round((ub.count / total) * 100);
                return (
                  <div key={ub.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300 truncate pr-4">{ub.name}</span>
                      <span className="font-bold text-slate-900 dark:text-slate-200 flex-shrink-0">{ub.count} plantões ({percentage}%)</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {unitsBreakdown.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">Nenhuma unidade com plantão agendado.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Alerts + Specialties) */}
        <div className="space-y-8">
          {/* Compliance Alerts */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-3">Pendências Críticas</h3>
            <p className="text-[11px] text-slate-400 mb-4">Médicos com documentação irregular</p>

            <div className="space-y-3">
              {doctorsWithAlerts.length > 0 ? (
                doctorsWithAlerts.map((doc) => {
                  const urgentCount = doc.alerts.filter((a) => a.status === 'expired' || a.status === 'rejected').length;
                  return (
                    <Link
                      key={doc.id}
                      href={`/medicos/${doc.id}`}
                      className="block p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-amber-400/50 dark:hover:border-amber-400/30 transition duration-150"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{doc.name}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">CRM {doc.crm}-{doc.crmUf} • {doc.specialty}</p>
                        </div>
                        {urgentCount > 0 ? (
                          <span className="flex-shrink-0 text-[9px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                            Crítico
                          </span>
                        ) : (
                          <span className="flex-shrink-0 text-[9px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
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
                <div className="py-6 text-center text-slate-400 text-xs">
                  Sem irregularidades críticas de documentação.
                </div>
              )}
            </div>
          </div>

          {/* Specialties Summary */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-4">Corpo Clínico</h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {specialtiesBreakdown.map((sb) => (
                <div key={sb.name} className="py-2.5 flex items-center justify-between text-xs first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-teal-500" />
                    <span className="font-medium text-slate-700 dark:text-slate-300">{sb.name}</span>
                  </div>
                  <span className="font-bold text-slate-950 dark:text-slate-200 bg-slate-100 dark:bg-slate-850 px-2 py-0.5 rounded">
                    {sb.count}
                  </span>
                </div>
              ))}
              {specialtiesBreakdown.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">Nenhuma especialidade registrada.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
