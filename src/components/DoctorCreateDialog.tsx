'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { canPerformAction } from '@/lib/permissions';
import { bankingFromForm } from '@/lib/doctorBanking';
import Dialog from './Dialog';
import DoctorProfileFields, { doctorProfileFromForm } from './DoctorProfileFields';
import DoctorBankingFields from './DoctorBankingFields';

export default function DoctorCreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const user = useStore(state => state.currentUser);
  const org = useStore(state => state.organizations.find(org => org.id === state.activeOrganizationId));
  const formId = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canCreate = canPerformAction(user, 'medicos', 'create');
  const canBanking = canPerformAction(user, 'dados_bancarios', 'edit');
  const canDocuments = canPerformAction(user, 'documentos', 'edit');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || busy) return;
    const openDocuments = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'documents';
    const form = new FormData(event.currentTarget);
    let profile, banking;
    try { profile = doctorProfileFromForm(form); banking = canBanking ? bankingFromForm(form) : undefined; }
    catch (failure) { setError((failure as Error).message); return; }
    setBusy(true); setError('');
    try {
      const id = await useStore.getState().addDoctor(profile, banking);
      if (!id) { setError(useStore.getState().error || 'Não foi possível salvar o cadastro. Tente novamente.'); return; }
      onCreated(); onClose();
      if (openDocuments && canDocuments) router.push(`/documentos/${id}`);
    } finally { setBusy(false); }
  }
  return <Dialog title="Cadastrar médico" size="lg" onClose={onClose} closeDisabled={busy} footer={<div className="space-y-2">
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><button className="nv-button-secondary" disabled={busy} onClick={onClose}>Cancelar</button>
      <button type="submit" form={formId} className="nv-button" disabled={busy || !canCreate}>{busy ? 'Salvando…' : 'Salvar cadastro'}</button>
      {canDocuments && <button type="submit" form={formId} value="documents" className="nv-button-secondary" disabled={busy || !canCreate}>Salvar e enviar documentos</button>}
    </div></div>}>
    <form id={formId} onSubmit={save} aria-busy={busy}><fieldset disabled={busy || !canCreate} className="min-w-0 space-y-6">
      <DoctorProfileFields specialties={org?.settings.specialties || []}/>
      <div className="border-t border-border pt-4">{canBanking ? <DoctorBankingFields/> : <section aria-label="Dados bancários" className="space-y-2">
        <h3 className="nv-section-title">Dados bancários</h3>
        <p className="text-sm text-text-muted">O cadastro será salvo como pendente. Um usuário autorizado ou o próprio médico deverá preencher a chave PIX e seu tipo para concluir o cadastro.</p>
      </section>}</div>
      <p className="text-xs text-text-muted">O cadastro não cria acesso ao portal nem envia convites. A liberação será individual na página do médico.</p>
    </fieldset></form>
  </Dialog>;
}
