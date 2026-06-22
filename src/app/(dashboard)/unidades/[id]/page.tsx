'use client';

import { use } from 'react';
import { useStore } from '@/store/useStore';
import {
  Building2,
  ArrowLeft,
  Calendar,
  Users,
  MapPin,
  Phone,
  User,
  CheckCircle2,
  Clock,
  Briefcase
} from 'lucide-react';
import Link from 'next/link';

export default function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const unitId = resolvedParams.id;

  const { activeOrganizationId, units, doctors, shifts } = useStore();

  const unit = units.find((u) => u.id === unitId && u.organizationId === activeOrganizationId);
  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId);
  const orgShifts = shifts.filter((s) => s.organizationId === activeOrganizationId);

  if (!unit) {
    return (
      <div className="text-center py-12">
        <Building2 className="h-10 w-10 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-text-secondary">Unidade não encontrada</h3>
        <p className="text-sm text-text-muted mt-1">O registro procurado não pertence a esta empresa ou foi apagado.</p>
        <Link href="/unidades" className="mt-4 inline-flex items-center gap-1 text-primary hover:underline text-xs font-semibold">
          <ArrowLeft className="h-4 w-4" />
          Voltar para listagem
        </Link>
      </div>
    );
  }

  // Find doctors linked to this unit
  const linkedDoctors = orgDoctors.filter((doc) => doc.linkedUnits.includes(unitId));

  // Find upcoming shifts at this unit
  const upcomingShifts = orgShifts
    .filter((s) => s.unitId === unitId && s.date >= '2026-06-21' && s.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .slice(0, 8);

  const unitTypeLabels = {
    hospital: 'Hospital',
    clinic: 'Clínica',
    er: 'Pronto Atendimento',
    upa: 'UPA',
    lab: 'Laboratório'
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Back Navigation & Title */}
      <div>
        <Link href="/unidades" className="inline-flex items-center gap-1 text-text-muted hover:text-text-primary text-xs font-semibold mb-2 cursor-pointer">
          <ArrowLeft className="h-4 w-4" />
          Voltar para listagem
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text-primary tracking-tight">{unit.name}</h2>
            <p className="text-xs text-text-muted mt-1">Tipo: {unitTypeLabels[unit.type]} • CNPJ: {unit.cnpj}</p>
          </div>
          <div>
            {unit.status === 'active' ? (
              <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border border-emerald-100 dark:border-emerald-900/30">
                <CheckCircle2 className="h-4 w-4" />
                Unidade Ativa
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border border-red-100 dark:border-red-900/30">
                <CheckCircle2 className="h-4 w-4" />
                Desativada
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Grid structure */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column (Metadata details & Specialties) */}
        <div className="space-y-6">
          <div className="bg-card-bg rounded-xl border border-card-border p-6 space-y-4">
            <div className="flex items-center gap-3 pb-4 border-b border-border">
              <div className="bg-primary/10 text-primary p-2 rounded-lg">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-text-primary leading-tight">Especificações Físicas</p>
                <p className="text-[10px] text-text-muted font-semibold uppercase mt-0.5">{unit.type}</p>
              </div>
            </div>

            <div className="space-y-3.5 text-xs text-text-secondary">
              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 text-text-muted flex-shrink-0" />
                <div>
                  <span className="block text-[10px] text-text-muted uppercase font-bold">Localização</span>
                  <span>{unit.address}</span>
                  <span className="block font-medium mt-0.5">{unit.city} - {unit.state}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <User className="h-4 w-4 text-text-muted flex-shrink-0" />
                <div>
                  <span className="block text-[10px] text-text-muted uppercase font-bold">Diretor Técnico / Responsável</span>
                  <span>{unit.manager}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Phone className="h-4 w-4 text-text-muted flex-shrink-0" />
                <div>
                  <span className="block text-[10px] text-text-muted uppercase font-bold">Telefone Geral</span>
                  <span>{unit.phone}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Serviced specialties */}
          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Briefcase className="h-4 w-4 text-primary" />
              Especialidades Disponíveis
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {unit.specialties.map((spec) => (
                <span key={spec} className="bg-background border border-card-border text-xs font-medium text-text-secondary px-3 py-1 rounded-lg">
                  {spec}
                </span>
              ))}
              {unit.specialties.length === 0 && (
                <p className="text-xs text-text-muted italic">Nenhuma especialidade associada.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Columns (Linked Doctors & Upcoming Shifts) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Linked doctors roster */}
          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Users className="h-4.5 w-4.5 text-primary" />
              Corpo Clínico Escalonado ({linkedDoctors.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {linkedDoctors.length > 0 ? (
                linkedDoctors.map((doc) => (
                  <Link
                    key={doc.id}
                    href={`/medicos/${doc.id}`}
                    className="p-3 bg-slate-50/50 dark:bg-slate-950/40 rounded-lg border border-border hover:border-primary/40 transition duration-150 flex items-center gap-3 text-xs cursor-pointer group"
                  >
                    <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                      {doc.name.charAt(4)}
                    </div>
                    <div className="min-w-0 font-medium">
                      <p className="font-semibold text-text-primary group-hover:text-primary transition-colors truncate">{doc.name}</p>
                      <p className="text-[10px] text-text-muted truncate">CRM {doc.crm}-{doc.crmUf} • {doc.specialty}</p>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="text-xs text-text-muted italic col-span-2 py-4 text-center">Nenhum médico vinculado a esta unidade.</p>
              )}
            </div>
          </div>

          {/* Upcoming shifts list */}
          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Calendar className="h-4.5 w-4.5 text-primary" />
              Próximos Plantões Agendados
            </h3>
            <div className="divide-y divide-border">
              {upcomingShifts.length > 0 ? (
                upcomingShifts.map((shift) => {
                  const doc = orgDoctors.find((d) => d.id === shift.doctorId);
                  
                  const typeLabels = {
                    onsite: 'Presencial',
                    oncall: 'Sobreaviso',
                    telemedicine: 'Telemedicina'
                  };

                  return (
                    <div key={shift.id} className="py-3 flex items-center justify-between text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition px-2 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-7 rounded-full bg-surface-muted flex items-center justify-center font-semibold text-text-muted text-[10px]">
                          {doc?.name.charAt(4) || 'M'}
                        </div>
                        <div>
                          <p className="font-semibold text-text-primary">{doc?.name}</p>
                          <p className="text-[10px] text-text-muted">{doc?.specialty} • Tipo: {typeLabels[shift.type]}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-bold text-text-secondary">
                          {new Date(shift.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        </p>
                        <p className="text-[10px] text-text-muted flex items-center gap-0.5 justify-end mt-0.5">
                          <Clock className="h-3 w-3" />
                          {shift.startTime} - {shift.endTime}
                        </p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-text-muted italic py-6 text-center">Nenhum plantão agendado para esta unidade.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
