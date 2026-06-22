'use client';

import { useState, Suspense } from 'react';
import { useStore } from '@/store/useStore';
import { useSearchParams } from 'next/navigation';
import { ShiftType, ShiftStatus } from '@/types';
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Stethoscope,
  Trash2
} from 'lucide-react';

function EscalaPageContent() {
  const {
    activeOrganizationId,
    organizations,
    doctors,
    units,
    shifts,
    addShift,
    deleteShift
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId && d.status === 'active');
  const orgUnits = units.filter((u) => u.organizationId === activeOrganizationId && u.status === 'active');
  const orgShifts = shifts.filter((s) => s.organizationId === activeOrganizationId);

  const searchParams = useSearchParams();
  const urlDate = searchParams?.get('date') || '';
  const urlDoctorId = searchParams?.get('doctorId') || 'all';
  const urlUnitId = searchParams?.get('unitId') || 'all';

  // Month navigation state (defaulting to June 2026)
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(5); // 0-indexed, 5 = June

  // Filter States
  const [filterDocId, setFilterDocId] = useState(urlDoctorId);
  const [filterUnitId, setFilterUnitId] = useState(urlUnitId);
  const [filterSpecialty, setFilterSpecialty] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDate, setFilterDate] = useState(urlDate);

  // Sync state if search parameters or organization changes
  const [prevUrlParams, setPrevUrlParams] = useState({
    doctorId: urlDoctorId,
    unitId: urlUnitId,
    date: urlDate,
    orgId: activeOrganizationId
  });

  if (
    urlDoctorId !== prevUrlParams.doctorId ||
    urlUnitId !== prevUrlParams.unitId ||
    urlDate !== prevUrlParams.date ||
    activeOrganizationId !== prevUrlParams.orgId
  ) {
    setPrevUrlParams({
      doctorId: urlDoctorId,
      unitId: urlUnitId,
      date: urlDate,
      orgId: activeOrganizationId
    });
    setFilterDocId(urlDoctorId);
    setFilterUnitId(urlUnitId);
    setFilterDate(urlDate);
    if (urlDate) {
      const parts = urlDate.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1; // 0-indexed
        if (!isNaN(y) && !isNaN(m)) {
          setCurrentYear(y);
          setCurrentMonth(m);
        }
      }
    }
  }


  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'month' | 'list'>('list');
  
  // Booking Form State
  const [bookingDocId, setBookingDocId] = useState('');
  const [bookingUnitId, setBookingUnitId] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [bookingStartTime, setBookingStartTime] = useState('08:00');
  const [bookingEndTime, setBookingEndTime] = useState('20:00');
  const [bookingType, setBookingType] = useState<ShiftType>('onsite');
  const [bookingStatus, setBookingStatus] = useState<ShiftStatus>('confirmed');
  const [bookingNotes, setBookingNotes] = useState('');

  // Define months and weekdays in PT-BR
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  // Calendar math
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay(); // Weekday index for 1st day

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  // Filter shifts
  const filteredShifts = orgShifts.filter((shift) => {
    const doc = doctors.find((d) => d.id === shift.doctorId);
    
    const matchesDoc = filterDocId === 'all' || shift.doctorId === filterDocId;
    const matchesUnit = filterUnitId === 'all' || shift.unitId === filterUnitId;
    const matchesSpecialty = filterSpecialty === 'all' || doc?.specialty === filterSpecialty;
    const matchesStatus = filterStatus === 'all' || shift.status === filterStatus;
    const matchesDate = filterDate === '' || shift.date === filterDate;

    return matchesDoc && matchesUnit && matchesSpecialty && matchesStatus && matchesDate;
  });

  // Calculate stats for sidebar
  const todayStr = '2026-06-21';
  const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  
  const totalMonthShifts = filteredShifts.filter((s) => s.date.startsWith(monthPrefix)).length;
  const shiftsToday = orgShifts.filter((s) => s.date === todayStr);

  // Group filtered shifts by date for mobile list view
  const sortedFilteredShifts = [...filteredShifts].sort((a, b) => a.date.localeCompare(b.date));
  const shiftsByDate: Record<string, typeof shifts> = {};
  sortedFilteredShifts.forEach((s) => {
    if (!shiftsByDate[s.date]) {
      shiftsByDate[s.date] = [];
    }
    shiftsByDate[s.date].push(s);
  });

  // Trigger booking creation
  const handleOpenBookingModal = (day?: number) => {
    if (orgDoctors.length === 0 || orgUnits.length === 0) {
      alert('Por favor, certifique-se de possuir médicos ativos e unidades ativas cadastradas primeiro.');
      return;
    }
    
    setBookingDocId(orgDoctors[0].id);
    setBookingUnitId(orgUnits[0].id);
    
    if (day) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      setBookingDate(dateStr);
    } else {
      setBookingDate(todayStr);
    }

    setBookingStartTime('08:00');
    setBookingEndTime('20:00');
    setBookingType('onsite');
    setBookingStatus('confirmed');
    setBookingNotes('');
    setIsModalOpen(true);
  };

  const handleCreateShift = (e: React.FormEvent) => {
    e.preventDefault();
    
    addShift({
      doctorId: bookingDocId,
      unitId: bookingUnitId,
      date: bookingDate,
      startTime: bookingStartTime,
      endTime: bookingEndTime,
      type: bookingType,
      status: bookingStatus,
      notes: bookingNotes
    });

    setIsModalOpen(false);
  };

  const handleDeleteShift = (id: string) => {
    if (confirm('Deseja excluir este plantão da escala?')) {
      deleteShift(id);
    }
  };

  // Helper to generate day grid cells
  const renderCalendarCells = () => {
    const cells = [];
    
    // Fill padding cells for previous month padding days
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(<div key={`pad-${i}`} className="bg-calendar-day-muted border-b border-r border-border min-h-[110px]" />);
    }

    // Fill days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dayStr === todayStr;
      const isFiltered = dayStr === filterDate;

      // Filter shifts scheduled on this specific day
      const dayShifts = filteredShifts.filter((s) => s.date === dayStr);

      cells.push(
        <div
          key={`day-${day}`}
          onClick={() => handleOpenBookingModal(day)}
          className={`group bg-calendar-day-bg border-b border-r border-border p-2 min-h-[120px] flex flex-col justify-between cursor-pointer hover:bg-state-hover transition-colors ${
            isToday ? 'ring-2 ring-primary ring-inset z-10 bg-calendar-today-bg shadow-glow-primary' : ''
          } ${
            isFiltered ? 'ring-2 ring-amber-500 ring-inset z-10 bg-amber-500/5' : ''
          }`}
        >
          {/* Day number & Indicator */}
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-bold h-5 w-5 rounded-full flex items-center justify-center font-mono ${
              isToday
                ? 'bg-primary text-text-inverse font-bold'
                : isFiltered
                ? 'bg-amber-500 text-white font-bold'
                : 'text-text-secondary'
            }`}>
              {day}
            </span>
            {isToday && <span className="text-[8px] uppercase tracking-wider text-primary font-bold">Hoje</span>}
            {isFiltered && !isToday && <span className="text-[8px] uppercase tracking-wider text-amber-500 font-bold">Filtrado</span>}
          </div>

          {/* Compact shifts list */}
          <div className="flex-1 space-y-1.5 mt-2 overflow-y-auto max-h-[85px] scrollbar-none" onClick={(e) => e.stopPropagation()}>
            {dayShifts.map((shift) => {
              const doc = doctors.find((d) => d.id === shift.doctorId);
              const unit = orgUnits.find((u) => u.id === shift.unitId);
              
              const isPast = shift.date < todayStr;
              const isCompletedOrCancelled = shift.status === 'completed' || shift.status === 'cancelled';
              const isNeutral = isPast || isCompletedOrCancelled;

              // Status left strip indicators
              const stripColors = {
                confirmed: 'border-l-[3px] border-emerald-500 bg-emerald-500/5',
                pending: 'border-l-[3px] border-amber-500 bg-amber-500/5',
                completed: 'border-l-[3px] border-blue-500 bg-blue-500/5',
                cancelled: 'border-l-[3px] border-red-500 bg-red-500/5'
              };

              return (
                <div
                  key={shift.id}
                  className={`p-1 text-[9px] rounded ${stripColors[shift.status]} ${isNeutral ? 'opacity-55' : ''} leading-tight relative group/item hover:bg-state-active`}
                  title={`${doc?.name} - ${shift.startTime} às ${shift.endTime} em ${unit?.name}`}
                >
                  <div className="flex items-start justify-between min-w-0">
                    <div className="min-w-0 pr-2">
                      <p className="font-bold text-text-primary truncate">{doc?.name.split(' ')[1] || doc?.name}</p>
                      <p className="text-[8px] text-text-muted truncate">{doc?.specialty} • {shift.startTime}</p>
                    </div>
                    {/* Delete shift action on hover inside day */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteShift(shift.id);
                      }}
                      className="hidden group-item-hover:block absolute right-0.5 top-0.5 text-danger hover:bg-danger/10 p-0.5 rounded cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    return cells;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Escala de Plantões</h2>
          <p className="text-sm text-text-muted mt-1">
            Consulte a grade de turnos mensais e organize alocações.
          </p>
        </div>
        <button
          onClick={() => handleOpenBookingModal()}
          className="bg-primary hover:bg-primary-hover text-white rounded-xl py-2.5 px-4 font-semibold text-xs flex items-center justify-center gap-2 self-start transition duration-200 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Novo Plantão
        </button>
      </div>

      {/* Main Grid: Filters + Calendar on Left, stats on right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Columns (Filters & Monthly Calendar Grid) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filters strip */}
          <div className="bg-card-bg p-4 rounded-xl border border-card-border grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Doctor */}
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-text-muted">Médico</label>
              <select
                value={filterDocId}
                onChange={(e) => setFilterDocId(e.target.value)}
                className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none"
              >
                <option value="all">Todos Médicos</option>
                {orgDoctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* Unit */}
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-text-muted">Unidade</label>
              <select
                value={filterUnitId}
                onChange={(e) => setFilterUnitId(e.target.value)}
                className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none"
              >
                <option value="all">Todas Unidades</option>
                {orgUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            {/* Specialty */}
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-text-muted">Especialidade</label>
              <select
                value={filterSpecialty}
                onChange={(e) => setFilterSpecialty(e.target.value)}
                className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none"
              >
                <option value="all">Todas Especialidades</option>
                {activeOrg?.settings.specialties.map((spec) => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-text-muted">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none"
              >
                <option value="all">Todos Status</option>
                <option value="confirmed">Confirmado</option>
                <option value="pending">Pendente</option>
                <option value="completed">Concluído</option>
              </select>
            </div>
          </div>

          {/* Active Filters Summary */}
          {(filterDocId !== 'all' || filterUnitId !== 'all' || filterSpecialty !== 'all' || filterStatus !== 'all' || filterDate !== '') && (
            <div className="bg-primary/5 border border-primary/20 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-in fade-in duration-200">
              <div className="text-xs text-text-secondary">
                <span className="font-bold text-primary mr-1">Filtros Ativos:</span>
                {filterDocId !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Médico: {orgDoctors.find(d => d.id === filterDocId)?.name}
                  </span>
                )}
                {filterUnitId !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Unidade: {orgUnits.find(u => u.id === filterUnitId)?.name}
                  </span>
                )}
                {filterSpecialty !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Especialidade: {filterSpecialty}
                  </span>
                )}
                {filterStatus !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Status: {filterStatus === 'confirmed' ? 'Confirmado' : filterStatus === 'pending' ? 'Pendente' : 'Concluído'}
                  </span>
                )}
                {filterDate !== '' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Data: {new Date(filterDate + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setFilterDocId('all');
                  setFilterUnitId('all');
                  setFilterSpecialty('all');
                  setFilterStatus('all');
                  setFilterDate('');
                  window.history.pushState({}, '', '/escala');
                }}
                className="text-xs font-bold text-primary hover:underline hover:text-primary-hover flex items-center gap-1 self-start sm:self-auto cursor-pointer"
              >
                ✕ Limpar Filtros
              </button>
            </div>
          )}

          {/* Calendar Box */}
          <div className="bg-card-bg rounded-xl border border-card-border overflow-hidden shadow-sm">
            {/* Calendar Controls */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-surface-muted/30 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">
                  {monthNames[currentMonth]} {currentYear}
                </h3>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Mobile view toggle */}
                <div className="md:hidden flex items-center bg-surface-muted p-0.5 rounded-lg border border-border mr-1.5">
                  <button
                    type="button"
                    onClick={() => setMobileViewMode('month')}
                    className={`px-2.5 py-1 text-[9px] font-bold rounded-md transition cursor-pointer ${
                      mobileViewMode === 'month'
                        ? 'bg-primary text-text-inverse shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Mês
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileViewMode('list')}
                    className={`px-2.5 py-1 text-[9px] font-bold rounded-md transition cursor-pointer ${
                      mobileViewMode === 'list'
                        ? 'bg-primary text-text-inverse shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Lista
                  </button>
                </div>

                <button
                  onClick={handlePrevMonth}
                  className="p-1 rounded-lg border border-card-border hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary transition cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setCurrentYear(2026);
                    setCurrentMonth(5); // June
                  }}
                  className="px-2.5 py-1 text-[10px] rounded-lg border border-card-border hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary font-semibold cursor-pointer"
                >
                  Hoje (Jun 2026)
                </button>
                <button
                  onClick={handleNextMonth}
                  className="p-1 rounded-lg border border-card-border hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary transition cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Weekdays Row */}
            <div className={`grid grid-cols-7 border-b border-border bg-surface-muted/20 text-center py-2 text-[10px] font-bold text-text-muted uppercase tracking-wider ${
              mobileViewMode === 'list' ? 'hidden md:grid' : 'grid'
            }`}>
              {weekdays.map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>

            {/* Calendar Grid Cells */}
            <div className={`grid grid-cols-7 bg-surface-muted/5 border-b border-border ${
              mobileViewMode === 'list' ? 'hidden md:grid' : 'grid'
            }`}>
              {renderCalendarCells()}
            </div>

            {/* Mobile list view */}
            {mobileViewMode === 'list' && (
              <div className="space-y-4 p-4 md:hidden">
                {Object.keys(shiftsByDate).length > 0 ? (
                  Object.entries(shiftsByDate).map(([date, dateShifts]) => {
                    const [yr, mo, dy] = date.split('-');
                    const dateObj = new Date(Number(yr), Number(mo) - 1, Number(dy));
                    const weekdayStr = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
                    
                    return (
                      <div key={date} className="space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-primary border-b border-border pb-1 mt-2">
                          {`${dy}/${mo}/${yr} — ${weekdayStr}`}
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {dateShifts.map((shift) => {
                            const doc = doctors.find((d) => d.id === shift.doctorId);
                            const unit = orgUnits.find((u) => u.id === shift.unitId);
                            
                            const statusBadgeColors = {
                              confirmed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-450 border border-emerald-500/20',
                              pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20',
                              completed: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
                              cancelled: 'bg-red-500/10 text-red-655 dark:text-red-400 border border-red-500/20',
                            };
                            
                            const statusLabel = {
                              confirmed: 'Confirmado',
                              pending: 'Pendente',
                              completed: 'Concluído',
                              cancelled: 'Cancelado',
                            };

                            return (
                              <div
                                key={shift.id}
                                className="bg-surface border border-card-border p-3 rounded-lg flex items-center justify-between text-xs transition hover:bg-state-hover"
                              >
                                <div className="space-y-1">
                                  <div className="font-bold text-text-primary">{doc?.name}</div>
                                  <div className="text-[10px] text-text-muted">
                                    {doc?.specialty} • {unit?.name}
                                  </div>
                                  <div className="text-[10px] text-text-secondary flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5 text-primary" />
                                    {shift.startTime} - {shift.endTime}
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-3">
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${statusBadgeColors[shift.status]}`}>
                                    {statusLabel[shift.status]}
                                  </span>
                                  
                                  <button
                                    onClick={() => handleDeleteShift(shift.id)}
                                    className="text-danger hover:bg-danger/10 p-1.5 rounded cursor-pointer transition"
                                    title="Excluir"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-12 text-center text-text-muted text-xs italic">
                    Nenhum plantão correspondente para os filtros selecionados.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Side indicators) */}
        <div className="space-y-6">
          {/* Calendar metrics stats */}
          <div className="bg-card-bg rounded-xl border border-card-border p-5 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Resumo da Grade</h3>
            <div className="grid grid-cols-1 gap-2.5">
              <div className="bg-background border border-border p-3 rounded-lg">
                <span className="text-[10px] text-text-muted block uppercase font-medium">Plantões no Mês</span>
                <span className="text-xl font-extrabold text-text-primary mt-1 block">{totalMonthShifts}</span>
              </div>
              <div className="bg-background border border-border p-3 rounded-lg">
                <span className="text-[10px] text-text-muted block uppercase font-medium">Plantões Hoje</span>
                <span className="text-xl font-extrabold text-primary mt-1 block">{shiftsToday.length}</span>
              </div>
            </div>
          </div>

          {/* Plantonistas de Hoje */}
          <div className="bg-card-bg rounded-xl border border-card-border p-5">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Escalados Hoje (21/06)</h3>
            <div className="space-y-2">
              {shiftsToday.length > 0 ? (
                shiftsToday.map((shift) => {
                  const doc = doctors.find((d) => d.id === shift.doctorId);
                  const unit = orgUnits.find((u) => u.id === shift.unitId);
                  
                  const typeBadgeColors = {
                    onsite: 'bg-primary/10 text-primary',
                    oncall: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    telemedicine: 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                  };

                  return (
                    <div key={shift.id} className="p-3 bg-background border border-border rounded-lg text-xs flex justify-between items-start">
                      <div>
                        <p className="font-bold text-text-secondary">{doc?.name}</p>
                        <p className="text-[10px] text-text-muted mt-0.5">{doc?.specialty} • {unit?.name}</p>
                        <span className="inline-block mt-2 text-[9px] font-semibold text-text-muted flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {shift.startTime} - {shift.endTime}
                        </span>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${typeBadgeColors[shift.type]}`}>
                        {shift.type === 'onsite' ? 'Presencial' : shift.type === 'oncall' ? 'Sobreaviso' : 'Telemedicina'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-text-muted italic py-4 text-center">Nenhum plantão escalado hoje.</p>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Booking Shift Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="bg-card-bg rounded-xl border border-border max-w-md w-full max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Stethoscope className="h-4.5 w-4.5 text-primary" />
                  Agendar Novo Plantão
                </h3>
                <p className="text-[10px] text-text-muted mt-0.5">Reserve um turno médico na grade de escalas</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-text-muted hover:text-text-primary text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreateShift} className="p-5 space-y-4 overflow-y-auto">
              {/* Doctor */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Médico Escalado</label>
                <select
                  value={bookingDocId}
                  onChange={(e) => setBookingDocId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                >
                  {orgDoctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name} ({doc.specialty})
                    </option>
                  ))}
                </select>
              </div>

              {/* Unit */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Unidade Hospitalar</label>
                <select
                  value={bookingUnitId}
                  onChange={(e) => setBookingUnitId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                >
                  {orgUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Data do Turno</label>
                <input
                  type="date"
                  required
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>

              {/* Time grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Hora Início</label>
                  <input
                    type="time"
                    required
                    value={bookingStartTime}
                    onChange={(e) => setBookingStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Hora Fim</label>
                  <input
                    type="time"
                    required
                    value={bookingEndTime}
                    onChange={(e) => setBookingEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
              </div>

              {/* Booking Type & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Modalidade</label>
                  <select
                    value={bookingType}
                    onChange={(e) => setBookingType(e.target.value as ShiftType)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    <option value="onsite">Presencial</option>
                    <option value="oncall">Sobreaviso</option>
                    <option value="telemedicine">Telemedicina</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Status do Turno</label>
                  <select
                    value={bookingStatus}
                    onChange={(e) => setBookingStatus(e.target.value as ShiftStatus)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    <option value="confirmed">Confirmado</option>
                    <option value="pending">Pendente</option>
                    <option value="completed">Concluído</option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Observações</label>
                <textarea
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  placeholder="Ex: Levar carimbo, UTI Coronária..."
                  className="w-full px-3 py-2 text-xs bg-background border border-border text-text-primary rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition h-16 resize-none"
                />
              </div>

              {/* Footer */}
              <div className="border-t border-border pt-4 flex items-center justify-end gap-3 bg-card-bg">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-card-border text-text-muted dark:text-text-secondary font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-xs transition duration-200 cursor-pointer"
                >
                  Confirmar Plantão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EscalaPage() {
  return (
    <Suspense fallback={
      <div className="flex h-48 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-teal-500" />
      </div>
    }>
      <EscalaPageContent />
    </Suspense>
  );
}
