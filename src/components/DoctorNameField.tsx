'use client';

import { useId, useState } from 'react';
import { normalizeDoctorName, validateDoctorName } from '@/lib/doctorName';

export default function DoctorNameField({ initial = '', preserve = false, allowOverride = false, wide = false }: {
  initial?: string; preserve?: boolean; allowOverride?: boolean; wide?: boolean;
}) {
  const fieldId = useId();
  const overrideId = `${fieldId}-override`;
  const [value, setValue] = useState(initial);
  const [override, setOverride] = useState(preserve);
  const [error, setError] = useState('');

  function checkName() {
    if (!value || (value === initial && preserve === override)) return;
    try {
      validateDoctorName(value);
      setValue(normalizeDoctorName(value, override));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return <div className={wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
    <label className="nv-label" htmlFor={fieldId}>Nome completo</label>
    <input id={fieldId} className="nv-input" name="name" autoComplete="name" value={value} required
      aria-invalid={Boolean(error)} aria-describedby={error ? `${fieldId}-error` : undefined}
      onChange={event => { setValue(event.target.value); setError(''); }}
      onBlur={event => { if (event.relatedTarget?.id !== overrideId) checkName(); }}/>
    {error && <p id={`${fieldId}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    {allowOverride && <label className="flex min-h-10 items-center gap-2 text-sm">
      <input id={overrideId} name="nameCapitalizationOverride" type="checkbox" checked={override} onChange={event => setOverride(event.target.checked)}/>
      Preservar a capitalização informada
    </label>}
  </div>;
}
