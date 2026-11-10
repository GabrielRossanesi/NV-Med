'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AccessGuard from '@/components/AccessGuard';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { useStore } from '@/store/useStore';

type Terms = { payment_day: number; month_offset: number; short_month: string; business_adjustment: string; holidays: string[] };

function TermsForm({ organization }: { organization: string }) {
  const [terms, setTerms] = useState<Terms | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const client = createClient();
    if (client && organization) void client.rpc('nv_payment_terms', { org: organization }).then(result => {
      if (!active) return;
      if (result.error) setError('Não foi possível abrir as regras de pagamento.');
      else setTerms(result.data);
    });
    return () => { active = false; };
  }, [organization]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const holidays = String(fields.get('holidays')).split(/[\s,]+/).filter(Boolean);
    if (holidays.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)) {
      setError('Informe os feriados com datas válidas no formato AAAA-MM-DD.');
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await createClient()?.rpc('nv_save_payment_terms', {
        org: organization, day_of_month: Number(fields.get('day')), offset_month: Number(fields.get('offset')),
        missing_day: fields.get('shortMonth'), adjustment: fields.get('adjustment'), holiday_dates: [...new Set(holidays)],
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      setNotice('Regras de vencimento salvas.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  return <section className="max-w-2xl space-y-4 rounded-xl border border-border bg-card-bg p-5">
    {terms === undefined && !error && <p role="status" className="text-sm text-text-muted">Carregando regras de pagamento…</p>}
    {terms !== undefined && <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="nv-label">Dia do pagamento<input className="nv-input" type="number" name="day" defaultValue={terms?.payment_day ?? 20} min={1} max={31} required/></label>
        <label className="nv-label">Mês de referência<select className="nv-input" name="offset" defaultValue={terms?.month_offset ?? 1}><option value={0}>Mês do plantão</option><option value={1}>Mês seguinte</option></select></label>
        <label className="nv-label">Quando o dia não existe<select className="nv-input" name="shortMonth" defaultValue={terms?.short_month ?? 'last_day'}><option value="last_day">Último dia do mês</option><option value="next_month">Primeiro dia do mês seguinte</option></select></label>
        <label className="nv-label">Fins de semana e feriados<select className="nv-input" name="adjustment" defaultValue={terms?.business_adjustment ?? 'none'}><option value="none">Manter data</option><option value="next">Próximo dia útil</option><option value="previous">Dia útil anterior</option></select></label>
      </div>
      <label className="nv-label">Feriados da empresa<textarea className="nv-input" name="holidays" rows={4} defaultValue={terms?.holidays.join('\n')} placeholder="AAAA-MM-DD, uma data por linha" maxLength={5000}/></label>
      <button className="nv-button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar regras de vencimento'}</button>
    </form>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
  </section>;
}

export default function TermsPage() {
  const organization = useStore(state => state.activeOrganizationId);
  return <AccessGuard requiredPermission="configuracoes"><div className="space-y-5">
    <header className="border-b border-border pb-4">
      <Link href="/financeiro" className="text-sm font-semibold text-primary underline">Voltar ao financeiro</Link>
      <h1 className="mt-2 text-2xl font-bold">Regras de vencimento</h1>
      <p className="mt-1 text-sm text-text-muted">Defina os vencimentos mensais da empresa. Vencimentos já calculados são preservados.</p>
    </header>
    <TermsForm key={organization} organization={organization}/>
  </div></AccessGuard>;
}
