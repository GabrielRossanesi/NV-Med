'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  applyCepAddress, doctorAddressFieldLimits, doctorAddressLimit, emptyDoctorAddress, formatDoctorAddress,
  normalizeDoctorCep, parseDoctorAddress, type CepAddress,
} from '@/lib/doctorAddress';
import { crmStates } from '@/lib/documentRequirements';

const messages = {
  idle: '',
  loading: 'Consultando CEP…',
  found: 'CEP localizado. Revise e complete o endereço.',
  invalid: 'Informe um CEP de oito dígitos.',
  missing: 'CEP não encontrado. Preencha o endereço manualmente.',
  unavailable: 'Consulta de CEP indisponível. Você pode preencher o endereço manualmente.',
};

export default function DoctorAddressFields({ initialAddress = '', required }: { initialAddress?: string | null; required: boolean }) {
  const [draft, setDraft] = useState(() => {
    const initial = initialAddress ?? '';
    const parsed = parseDoctorAddress(initial);
    return {
      fields: parsed || emptyDoctorAddress,
      confirmedCep: parsed?.cep || '',
      freeform: parsed ? '' : initial,
      structured: Boolean(parsed || !initial),
      legacy: Boolean(initial && !parsed),
    };
  });
  const [status, setStatus] = useState<keyof typeof messages>('idle');
  const feedbackId = useId();
  const request = useRef<AbortController | null>(null);
  const cached = useRef(new Map<string, CepAddress | null>());

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function lookup(cep: string) {
    function applyResult(result: CepAddress | null) {
      if (!result) { setStatus('missing'); return; }
      setDraft(current => ({
        ...current,
        fields: applyCepAddress(current.fields, draft.fields, result),
        confirmedCep: cep,
        structured: current.structured || (current.structured === draft.structured && current.freeform === draft.freeform),
      }));
      setStatus('found');
    }

    const previous = cached.current.get(cep);
    if (previous !== undefined) { applyResult(previous); return; }

    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 9_000);
    setStatus('loading');
    try {
      const response = await fetch(`/api/cep?cep=${cep}`, { signal: controller.signal });
      if (!response.ok && response.status !== 404) throw new Error('CEP lookup failed');
      const result: CepAddress | null = response.status === 404 ? null : await response.json();
      if (request.current !== controller) return;
      cached.current.set(cep, result);
      applyResult(result);
    } catch {
      if (request.current === controller) setStatus('unavailable');
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  }

  function changeField(field: keyof typeof emptyDoctorAddress, value: string) {
    setDraft(current => ({ ...current, fields: { ...current.fields, [field]: value } }));
  }

  function changeCep(value: string) {
    changeField('cep', value);
    const cep = normalizeDoctorCep(value);
    if (cep && cep === normalizeDoctorCep(draft.fields.cep)) return;

    request.current?.abort();
    request.current = null;
    if (cep) void lookup(cep);
    else setStatus(value.trim().length >= 8 ? 'invalid' : 'idle');
  }

  const fields = draft.fields;
  const keepLegacy = draft.legacy && !fields.street.trim();
  const address = keepLegacy ? draft.freeform : formatDoctorAddress({ ...fields, cep: fields.cep.trim() ? draft.confirmedCep : '' });
  const invalidCep = status === 'invalid' || status === 'missing';

  function toggleMode() {
    setDraft(current => ({
      ...current,
      structured: !current.structured,
      freeform: current.structured ? current.freeform || address : current.freeform,
    }));
  }

  return <div className="space-y-3 sm:col-span-2">
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <label className="nv-label w-40">CEP
        <input name="cep" className="nv-input" inputMode="numeric" autoComplete="postal-code" maxLength={doctorAddressFieldLimits.cep}
          value={fields.cep} onChange={event => changeCep(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
          onBlur={() => { if (fields.cep.trim() && !normalizeDoctorCep(fields.cep)) setStatus('invalid'); }}
          aria-invalid={invalidCep || undefined} aria-describedby={feedbackId}/>
      </label>
      <button type="button" className="min-h-10 text-left text-sm font-semibold text-primary hover:underline" onClick={toggleMode}>
        {draft.structured ? 'Usar endereço livre' : 'Usar campos de endereço'}
      </button>
    </div>
    <div className={status === 'idle' ? 'sr-only' : 'flex flex-wrap items-center gap-x-3 gap-y-1'}>
      <p id={feedbackId} role="status" className={`text-sm ${invalidCep || status === 'unavailable' ? 'text-danger' : 'text-text-secondary'}`}>{messages[status]}</p>
      {status === 'unavailable' && <button type="button" className="min-h-10 text-sm font-semibold text-primary hover:underline"
        onClick={() => void lookup(normalizeDoctorCep(fields.cep))}>Tentar novamente</button>}
    </div>

    {draft.structured ? <>
      <input type="hidden" name="address" value={address}/>
      {draft.legacy && draft.freeform && <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-text-secondary">Endereço anterior</summary>
        <p className="mt-2 wrap-anywhere whitespace-pre-line text-text-secondary">{draft.freeform}</p>
      </details>}
      {keepLegacy && draft.freeform && <p className="text-xs text-text-muted">Informe o logradouro para substituir o endereço salvo.</p>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-4">
        <label className="nv-label sm:col-span-2">Logradouro<input className="nv-input" value={fields.street} onChange={event => changeField('street', event.target.value)} required={required} maxLength={doctorAddressFieldLimits.street} autoComplete="address-line1"/></label>
        <label className="nv-label">Número<input className="nv-input" value={fields.number} onChange={event => changeField('number', event.target.value)} maxLength={doctorAddressFieldLimits.number}/></label>
        <label className="nv-label">Complemento<input className="nv-input" value={fields.complement} onChange={event => changeField('complement', event.target.value)} maxLength={doctorAddressFieldLimits.complement} autoComplete="address-line2"/></label>
        <label className="nv-label">Bairro<input className="nv-input" value={fields.district} onChange={event => changeField('district', event.target.value)} maxLength={doctorAddressFieldLimits.district} autoComplete="address-level3"/></label>
        <label className="nv-label">Cidade<input className="nv-input" value={fields.city} onChange={event => changeField('city', event.target.value)} maxLength={doctorAddressFieldLimits.city} autoComplete="address-level2"/></label>
        <label className="nv-label">UF<select className="nv-input" value={fields.state} onChange={event => changeField('state', event.target.value)} autoComplete="address-level1">
          <option value="">Selecione</option>{crmStates.map(state => <option key={state}>{state}</option>)}
        </select></label>
      </div>
    </> : <label className="nv-label">Endereço residencial
      <textarea name="address" className="nv-input" value={draft.freeform} onChange={event => setDraft(current => ({ ...current, freeform: event.target.value }))}
        rows={2} maxLength={doctorAddressLimit} required={required} autoComplete="street-address"/>
    </label>}
  </div>;
}
