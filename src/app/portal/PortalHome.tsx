'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ChevronDown, ClipboardCheck, FileCheck2, LoaderCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { logoutCurrentSession } from '@/lib/auth/logout';
import { enrollmentStatusLabels, portalError, type EnrollmentStatus } from '@/lib/doctorPortal';
import { isStrongPassword } from '@/lib/passwordPolicy';
import { documentStatusClasses, documentStatusLabels } from '@/lib/documentCompliance';
import type { DocumentStatus } from '@/types';
import PortalSchedule from './PortalSchedule';
import NotificationInbox from '@/components/NotificationInbox';
import { crmStates } from '@/lib/documentRequirements';
import { authFlowUrl } from '@/lib/appOrigin';

type Enrollment = {
  doctor_id: string; organization_id: string; organization: string; name: string; status: EnrollmentStatus;
  portal_role?: 'Médico' | 'Coordenador Médico';
  crm: string; uf: string; cpf: string; phone: string; birth_date: string; specialties: string[]; review_note?: string; legacy_link: boolean;
};
type Catalog = { name: string; specialties: string[] };
type PortalDocument = { id: string; name: string; status: DocumentStatus; expiry_date?: string; has_file: boolean; review_note?: string };
const digits = (value: string) => value.replace(/\D/g, '');
const enrollmentTones: Record<EnrollmentStatus, string> = {
  approved: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  correction_requested: 'bg-warning/10 text-warning',
  rejected: 'bg-danger/10 text-danger',
};

function RegisterAccount({ organization }: { organization: string }) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function signUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const origin = window.location.origin;
    const callback = authFlowUrl('/auth/confirm', origin, organization);
    if (callback.origin !== origin) {
      window.location.assign(authFlowUrl('/portal', origin, organization).href);
      return;
    }
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get('password'));
    if (!isStrongPassword(password)) {
      setNotice('Use entre 12 e 72 caracteres, com maiúscula, minúscula, número e símbolo, sem espaços.');
      return;
    }
    const client = createClient();
    if (!client) return setNotice('Acesso indisponível. Entre em contato com a coordenação.');
    setBusy(true);
    try {
      const { data, error } = await client.auth.signUp({
        email: String(fields.get('email')).trim().toLowerCase(),
        password,
        options: { emailRedirectTo: callback.toString() },
      });
      if (error) return setNotice('Não foi possível iniciar o cadastro. Confira os dados ou tente entrar com uma conta existente.');
      if (data.session) window.location.replace('/portal' + (organization ? '?empresa=' + encodeURIComponent(organization) : ''));
      else setNotice('Confira seu e-mail para confirmar a conta. Em seguida, volte ao portal para enviar o cadastro.');
    } catch {
      setNotice('Conexão indisponível. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }
  return <section className="nv-panel p-5 sm:p-8">
    <h2 className="nv-section-title">Crie seu acesso médico</h2>
    <p className="mt-1 text-sm text-text-muted">Confirme seu e-mail para iniciar o credenciamento na empresa.</p>
    <form onSubmit={signUp} className="mt-5 space-y-4">
      <label className="nv-label">E-mail<input className="nv-input" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
      <label className="nv-label">Senha<input className="nv-input" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72}/></label>
      <button className="nv-button" disabled={busy}>{busy ? 'Criando acesso…' : 'Criar acesso médico'}</button>
      {notice && <p role="status" className="text-sm text-text-secondary">{notice}</p>}
    </form>
    <Link className="mt-6 inline-block text-sm font-semibold text-primary underline" href={organization ? '/login?empresa=' + encodeURIComponent(organization) : '/login?portal=1'}>Já tenho acesso</Link>
  </section>;
}

function EnrollmentForm({ email, organization, catalog, previous, onSaved }: { email: string; organization: string; catalog: Catalog; previous?: Enrollment; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await createClient()?.rpc('nv_submit_enrollment', {
        org: organization, full_name: fields.get('name'), registration: fields.get('crm'), uf: fields.get('uf'),
        tax_id: digits(String(fields.get('cpf'))), birth: fields.get('birth'), phone_number: digits(String(fields.get('phone'))),
        pix: fields.get('pix'), specialties: fields.getAll('specialties'),
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível enviar o cadastro.');
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={save} className="space-y-5 nv-panel p-5 sm:p-7">
    <h2 className="nv-section-title">{previous ? 'Corrigir cadastro' : 'Credenciamento'} · {catalog.name}</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="nv-label">Nome completo<input className="nv-input" name="name" autoComplete="name" defaultValue={previous?.name} required maxLength={150}/></label>
      <label className="nv-label">E-mail verificado<input className="nv-input" type="email" value={email} readOnly/></label>
      <label className="nv-label">CRM<input className="nv-input" name="crm" inputMode="numeric" pattern="[0-9]{1,12}" defaultValue={previous?.crm} required/></label>
      <label className="nv-label">UF do CRM<select className="nv-input" name="uf" defaultValue={previous?.uf || ''} required><option value="">Selecione</option>{crmStates.map(uf => <option key={uf}>{uf}</option>)}</select></label>
      <label className="nv-label">CPF<input className="nv-input" name="cpf" inputMode="numeric" defaultValue={previous?.cpf} required maxLength={14}/></label>
      <label className="nv-label">Nascimento<input className="nv-input" name="birth" type="date" autoComplete="bday" defaultValue={previous?.birth_date} required/></label>
      <label className="nv-label">Telefone<input className="nv-input" name="phone" type="tel" autoComplete="tel" defaultValue={previous?.phone} required maxLength={22}/></label>
      <label className="nv-label">Chave PIX<input className="nv-input" name="pix" required minLength={5} maxLength={140}/></label>
    </div>
    <fieldset className="space-y-2"><legend className="nv-label">Especialidades solicitadas</legend>
      <div className="grid gap-2 sm:grid-cols-2">{catalog.specialties.map(specialty => <label key={specialty} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm">
        <input name="specialties" type="checkbox" value={specialty} defaultChecked={previous?.specialties.includes(specialty)}/>{specialty}
      </label>)}</div>
    </fieldset>
    {error && <p role="alert" className="nv-feedback text-danger">{error}</p>}
    <button className="nv-button" disabled={busy || !catalog.specialties.length}>{busy ? 'Enviando…' : 'Enviar para aprovação'}</button>
  </form>;
}

function Documents({ doctor }: { doctor: string }) {
  const [documents, setDocuments] = useState<PortalDocument[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  async function load() {
    const result = await createClient()?.rpc('nv_portal_documents', { target: doctor });
    if (result?.error || !result) {
      setError('Não foi possível abrir sua pasta de documentos.');
      return;
    }
    setDocuments(result.data);
  }
  async function upload(event: React.FormEvent<HTMLFormElement>, document: PortalDocument) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    setBusy(document.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/portal/documents/' + encodeURIComponent(document.id), { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      form.reset();
      await load();
      setNotice('Documento enviado para análise.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível enviar o documento.');
    } finally {
      setBusy('');
    }
  }
  return <details className="nv-panel nv-disclosure" onToggle={event => { if (event.currentTarget.open && !documents) void load(); }}>
    <summary><FileCheck2 className="shrink-0 text-primary" size={18} aria-hidden="true"/><span>Meus documentos</span><ChevronDown className="shrink-0 text-text-muted" size={16} aria-hidden="true"/></summary>
    <div className="space-y-4 p-4 sm:p-5">
      {error && <p role="alert" className="nv-feedback text-danger">{error}</p>}
      {notice && <p role="status" className="nv-feedback text-success">{notice}</p>}
      {!documents && !error && <p role="status" className="text-sm text-text-muted">Carregando documentos…</p>}
      {documents?.length === 0 && <p className="nv-empty">A empresa ainda não tem exigências para este cadastro.</p>}
      {documents?.map(item => <article key={item.id} className="space-y-2 border-t border-border pt-4">
        <h3 className="font-medium">{item.name}</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span className={`nv-badge border ${documentStatusClasses[item.status]}`}>{documentStatusLabels[item.status]}</span>
          {item.expiry_date && <span>Válido até <time dateTime={item.expiry_date}>{item.expiry_date.split('-').reverse().join('/')}</time></span>}
        </div>
        {item.review_note && <p className="text-sm">{item.review_note}</p>}
        {item.has_file && <a className="text-sm font-semibold text-primary underline" href={'/api/portal/documents/' + encodeURIComponent(item.id)}>Baixar arquivo enviado</a>}
        <form onSubmit={event => upload(event, item)} className="flex flex-wrap items-end gap-2">
          <label className="nv-label min-w-0 max-w-full grow">PDF, JPEG ou PNG<input type="file" className="nv-input" name="file" accept=".pdf,.jpg,.jpeg,.png" required/></label>
          <button className="nv-button-secondary" disabled={Boolean(busy)}>{busy === item.id ? 'Enviando…' : item.has_file ? 'Enviar nova versão' : 'Enviar arquivo'}</button>
        </form>
      </article>)}
    </div>
  </details>;
}

export default function PortalHome({ email, initialOrganization }: { email: string; initialOrganization: string }) {
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [error, setError] = useState('');
  const [organization, setOrganization] = useState(initialOrganization);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadingCompany, setLoadingCompany] = useState(false);
  useEffect(() => {
    if (!email) return;
    let current = true;
    const client = createClient();
    if (!client) return;
    void client.rpc('nv_portal_enrollments').then(profiles => {
      if (!current) return;
      if (profiles.error) setError('Não foi possível carregar seu cadastro.');
      else setEnrollments(profiles.data);
    });
    return () => { current = false; };
  }, [email, revision]);
  async function findCompany(target: string) {
    setCatalog(null);
    setError('');
    setLoadingCompany(true);
    try {
      const result = await createClient()?.rpc('nv_enrollment_catalog', { org: target });
      if (!result || result.error || !result.data) {
        setError('Empresa indisponível. Confira o código com a coordenação.');
        return;
      }
      setOrganization(target);
      setCatalog(result.data);
    } finally {
      setLoadingCompany(false);
    }
  }
  const previous = enrollments?.find(item => item.organization_id === organization);
  return <main className="nv-content nv-portal-content mx-auto min-h-svh max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-8 sm:py-10">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5 max-md:pb-3">
      <div><p className="flex items-center gap-2 text-sm font-semibold text-primary"><span className="grid size-8 place-items-center rounded-lg bg-primary/10"><Activity size={17} aria-hidden="true"/></span>NV Med</p><h1 className="nv-page-title mt-2">Portal do médico</h1></div>
      {email && <button className="nv-button-secondary" onClick={() => void logoutCurrentSession().catch(failure => setError(failure.message))}>Sair</button>}
    </header>
    {error && <p role="alert" className="nv-feedback text-danger">{error}</p>}
    {!email ? <RegisterAccount organization={initialOrganization}/> : <>
      {enrollments === null && !error && <p role="status" className="nv-feedback items-center text-info"><LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true"/>Carregando credenciamento…</p>}
      {enrollments?.some(item => item.status === 'approved') && <PortalSchedule/>}
      {enrollments?.map((item, index) => <section key={item.doctor_id} id={index === 0 ? 'portal-perfil' : undefined} className="space-y-3">
        <div className="nv-panel p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{item.organization}</p>
          <h2 className="mt-1 nv-section-title">{item.name}</h2>
          <p className="mt-2 text-xs font-medium text-text-secondary">{item.portal_role || 'Médico'}</p>
          <p className={`nv-badge mt-2 ${enrollmentTones[item.status]}`}><ClipboardCheck size={15} aria-hidden="true"/>{enrollmentStatusLabels[item.status]}</p>
          {item.review_note && <p className="mt-2 text-sm">{item.review_note}</p>}
          {item.status === 'correction_requested' && <button className="nv-button-secondary mt-3" disabled={loadingCompany} onClick={() => void findCompany(item.organization_id)}>Corrigir cadastro</button>}
        </div>
        {item.status !== 'rejected' && (!item.legacy_link || item.status === 'approved') && <Documents doctor={item.doctor_id}/>}
      </section>)}
      {enrollments !== null && <section className="space-y-3">
        <form className="nv-panel flex flex-wrap items-end gap-3 p-4 sm:p-5" onSubmit={event => {
          event.preventDefault();
          void findCompany(String(new FormData(event.currentTarget).get('organization')).trim());
        }}>
          <label className="nv-label grow">Código da empresa<input name="organization" className="nv-input" defaultValue={initialOrganization} maxLength={100} required/></label>
          <button className="nv-button-secondary" disabled={loadingCompany}>{loadingCompany ? 'Consultando…' : 'Continuar credenciamento'}</button>
        </form>
        {catalog && (!previous || previous.status === 'correction_requested') && <EnrollmentForm
          key={organization} email={email} organization={organization} catalog={catalog} previous={previous}
          onSaved={() => { setCatalog(null); setRevision(value => value + 1); }}/>}
        {catalog && previous && previous.status !== 'correction_requested' && <p className="text-sm text-text-muted">Seu cadastro nesta empresa já está acima.</p>}
      </section>}
      <NotificationInbox preferences revision={revision}/>
    </>}
  </main>;
}
