'use client';

import { useEffect, useId, useState } from 'react';
import { emptyBanking, pixKeyTypes, type DoctorBanking } from '@/lib/doctorBanking';

type Bank = { name: string; code: string; ispb: string };
export default function DoctorBankingFields({ initial = emptyBanking, disabled = false }: { initial?: DoctorBanking; disabled?: boolean }) {
  const id = useId();
  const [type, setType] = useState(initial.pix_key_type);
  const [bank, setBank] = useState(initial.bank);
  const [code, setCode] = useState(initial.bank_code);
  const [ispb, setIspb] = useState(initial.bank_ispb);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/banks', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      setBanks(result.banks);
    }).catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, []);
  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <legend className="nv-section-title mb-3">Dados bancários</legend>
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">Dados PIX</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="nv-label"><span>Tipo de chave PIX <span className="text-text-muted">(obrigatório)</span></span>
          <select className="nv-input" name="pix_key_type" required value={type} onChange={event => setType(event.target.value as DoctorBanking['pix_key_type'])}>
            <option value="">Selecione o tipo</option>{Object.entries(pixKeyTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="nv-label"><span>Chave PIX <span className="text-text-muted">(obrigatório)</span></span>
          <input className="nv-input" name="pix_key" required autoComplete="off" spellCheck={false} defaultValue={initial.pix_key} maxLength={140}
            type={type === 'email' ? 'email' : type === 'phone' ? 'tel' : 'text'} inputMode={type === 'cpf' ? 'numeric' : undefined}
            placeholder={type === 'phone' ? '(11) 99999-9999 ou +código do país' : type === 'evp' ? 'UUID da chave aleatória' : undefined}/>
        </label>
      </div>
      <p className="text-xs leading-relaxed text-text-muted">Conferimos o formato da chave. Confirme se ela está registrada para recebimento na sua instituição financeira.</p>
    </fieldset>
    <fieldset className="space-y-3 border-t border-border pt-4">
      <legend className="px-1 text-sm font-semibold">Dados bancários adicionais <span className="font-normal text-text-muted">(opcionais)</span></legend>
      <label className="nv-label">Banco
        <input className="nv-input" name="bank" list={id} value={bank} autoComplete="off" maxLength={200} placeholder="Pesquise pelo nome, COMPE ou ISPB"
          onChange={event => {
            const value = event.target.value;
            const selected = banks.find(item => `${item.code || item.ispb} · ${item.name}` === value || item.name === value);
            setBank(selected?.name || value); setCode(selected?.code || ''); setIspb(selected?.ispb || '');
          }}/>
        <datalist id={id}>{banks.map(item => <option key={item.ispb} value={`${item.code || item.ispb} · ${item.name}`}>{item.ispb}</option>)}</datalist>
      </label>
      {unavailable && <p role="status" className="text-xs text-text-muted">Lista indisponível. Informe o banco manualmente ou continue sem preencher os campos opcionais.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="nv-label">Código COMPE<input className="nv-input" name="bank_code" value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" pattern="[0-9]{3}" maxLength={3} placeholder="Ex.: 001"/></label>
        <label className="nv-label">ISPB<input className="nv-input" name="bank_ispb" value={ispb} onChange={event => setIspb(event.target.value)} inputMode="numeric" pattern="[0-9]{8}" maxLength={8}/></label>
        <label className="nv-label">Agência<input className="nv-input" name="agency" autoComplete="off" defaultValue={initial.agency} maxLength={30} placeholder="Ex.: 0001-0"/></label>
        <label className="nv-label">Conta corrente<input className="nv-input" name="account_number" autoComplete="off" defaultValue={initial.account_number} maxLength={30} placeholder="Número e dígito verificador"/></label>
      </div>
    </fieldset>
  </fieldset>;
}
