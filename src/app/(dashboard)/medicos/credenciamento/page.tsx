'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/store/useStore';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import AccessGuard from '@/components/AccessGuard';
import Dialog from '@/components/Dialog';
import DoctorBankingPanel from '@/components/DoctorBankingPanel';
import { canViewPermission } from '@/lib/permissions';

type Request = {
  id: string; name: string; crm: string; uf: string; cpf: string; email: string; phone: string;
  birth_date: string; specialties: string[]; legacy_link: boolean; units?: string[];
};

function Decision({ request, organization, onClose, onSaved }: { request: Request; organization: string; onClose: () => void; onSaved: () => void }) {
  const actor = useStore(state => state.currentUser);
  const units = useStore(state => state.units).filter(item => item.organizationId === organization && item.status === 'active');
  const [decision, setDecision] = useState('approved');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const result = await createClient()?.rpc('nv_review_enrollment', {
        target: request.id, decision, note: fields.get('note'),
        specialties: fields.getAll('specialties'), units: fields.getAll('units'),
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a decisão.');
    } finally {
      setBusy(false);
    }
  }
  return <Dialog title={request.name} onClose={onClose}>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {Object.entries({ CRM: request.crm + ' / ' + request.uf, CPF: request.cpf, 'E-mail': request.email, Telefone: request.phone, Nascimento: request.birth_date.split('-').reverse().join('/') }).map(([label, value]) =>
        <div key={label}><dt className="text-text-muted">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
    </dl>
    {request.legacy_link && <p className="mt-3 text-sm text-text-muted">Solicitação de vínculo com um cadastro já existente nesta empresa.</p>}
    <a className="my-4 inline-block text-sm font-semibold text-primary underline" href={'/documentos/' + request.id}>Consultar documentos</a>
    {canViewPermission(actor, 'dados_bancarios') && <DoctorBankingPanel key={request.id} doctor={request.id}/>}
    <form onSubmit={review} className="mt-4 space-y-4">
      <label className="nv-label">Decisão<select className="nv-input" value={decision} onChange={event => setDecision(event.target.value)}>
        <option value="approved">Aprovar cadastro</option><option value="correction_requested">Solicitar correções</option><option value="rejected">Rejeitar cadastro</option>
      </select></label>
      {decision === 'approved' && <>
        <fieldset className="space-y-2"><legend className="nv-label">Especialidades autorizadas</legend>
          {request.specialties.map(item => <label key={item} className="flex items-center gap-2 text-sm"><input type="checkbox" name="specialties" value={item}/>{item}</label>)}
        </fieldset>
        <fieldset className="space-y-2"><legend className="nv-label">Unidades autorizadas</legend>
          {units.map(item => <label key={item.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="units" value={item.id} defaultChecked={request.units?.includes(item.id)}/>{item.name}</label>)}
        </fieldset>
      </>}
      <label className="nv-label">Justificativa<textarea className="nv-input" name="note" maxLength={1000} rows={3} required={decision !== 'approved'}/></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="nv-button" disabled={busy}>{busy ? 'Registrando…' : 'Confirmar decisão'}</button>
    </form>
  </Dialog>;
}

function EnrollmentQueue({ organization }: { organization: string }) {
  const [queue, setQueue] = useState<Request[] | null>(null);
  const [selected, setSelected] = useState<Request | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let current = true;
    if (organization) void (async () => {
      const result = await createClient()?.rpc('nv_enrollment_queue', { org: organization });
      if (!current) return;
      if (!result || result.error) setError('Não foi possível carregar os cadastros.');
      else setQueue(result.data);
    })();
    return () => { current = false; };
  }, [organization, revision]);

  return <div className="space-y-5">
    <header className="border-b border-border pb-4">
      <Link href="/dashboard" className="text-sm font-semibold text-primary underline">Voltar ao dashboard</Link>
      <h1 className="mt-2 text-2xl font-bold">Cadastros médicos aguardando aprovação</h1>
      {organization && <Link href={'/portal?empresa=' + encodeURIComponent(organization)} className="mt-2 inline-block text-sm font-semibold text-primary underline">Abrir link de credenciamento da empresa</Link>}
    </header>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {!queue && !error && <p role="status" className="text-sm text-text-muted">Carregando cadastros…</p>}
    {queue?.length === 0 && <p className="text-sm text-text-muted">Nenhum cadastro aguardando decisão nesta empresa.</p>}
    {queue && <ul className="divide-y divide-border">{queue.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div><h2 className="font-semibold">{item.name}</h2><p className="text-sm text-text-muted">{item.specialties.join(' · ')}</p></div>
      <button className="nv-button-secondary" onClick={() => setSelected(item)}>Analisar cadastro</button>
    </li>)}</ul>}
    {selected && <Decision request={selected} organization={organization} onClose={() => setSelected(null)}
      onSaved={() => { setSelected(null); setNotice('Decisão registrada.'); setRevision(value => value + 1); }}/>}
  </div>;
}

export default function EnrollmentQueuePage() {
  const organization = useStore(state => state.activeOrganizationId);
  return <AccessGuard requiredPermission="medicos" action="approve"><EnrollmentQueue key={organization} organization={organization}/></AccessGuard>;
}
