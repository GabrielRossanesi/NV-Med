'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';

type Settings = { latitude: number; longitude: number; radius_m: number; max_accuracy_m: number; tolerance_min: number; allow_manual: boolean };

export default function UnitAttendanceSettings({ unitId }: { unitId: string }) {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const client = createClient();
    if (client) void client.rpc('nv_unit_attendance', { unit: unitId }).then(result => {
      if (!active) return;
      if (result.error) setError('Não foi possível consultar a configuração de presença.');
      else setSettings(result.data);
    });
    return () => { active = false; };
  }, [unitId]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const result = await createClient()?.rpc('nv_save_unit_attendance', {
        unit: unitId, lat: Number(fields.get('latitude')), lon: Number(fields.get('longitude')),
        radius: Number(fields.get('radius')), precision_m: Number(fields.get('accuracy')), tolerance: Number(fields.get('tolerance')),
        manual: fields.has('manual'),
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      setNotice('Configuração de presença salva.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return <details className="rounded-xl border border-border bg-card-bg p-4">
    <summary className="cursor-pointer font-semibold">Presença e geolocalização</summary>
    {settings === undefined && !error && <p className="mt-3 text-sm text-text-muted">Carregando configuração…</p>}
    {settings !== undefined && <form onSubmit={save} className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="nv-label">Latitude<input className="nv-input" name="latitude" type="number" step="any" min={-90} max={90} defaultValue={settings?.latitude} required/></label>
        <label className="nv-label">Longitude<input className="nv-input" name="longitude" type="number" step="any" min={-180} max={180} defaultValue={settings?.longitude} required/></label>
        <label className="nv-label">Raio permitido (m)<input className="nv-input" name="radius" type="number" min={25} max={5000} defaultValue={settings?.radius_m ?? 150} required/></label>
        <label className="nv-label">Erro máximo da localização (m)<input className="nv-input" name="accuracy" type="number" min={5} max={200} defaultValue={settings?.max_accuracy_m ?? 80} required/></label>
        <label className="nv-label">Tolerância de horário (min)<input className="nv-input" name="tolerance" type="number" min={0} max={180} defaultValue={settings?.tolerance_min ?? 30} required/></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="manual" defaultChecked={settings?.allow_manual}/>Aceitar solicitações de registro manual</label>
      <button className="nv-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar configuração de presença'}</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mt-2 text-sm text-success">{notice}</p>}
  </details>;
}
