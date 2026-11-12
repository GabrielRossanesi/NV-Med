import { NextResponse } from 'next/server';

// Public institution directory only. No physician data is sent to the provider.
export async function GET() {
  try {
    const response = await fetch('https://brasilapi.com.br/api/banks/v1', { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Directory unavailable');
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid directory');
    const banks = data.filter((bank): bank is { name: string; fullName?: string; code: number | null; ispb: string } =>
      typeof bank?.name === 'string' && /^\d{8}$/.test(bank.ispb) && (bank.code == null || (Number.isInteger(bank.code) && bank.code >= 0 && bank.code <= 999)))
      .map(bank => ({ name: bank.fullName || bank.name, code: bank.code == null ? '' : String(bank.code).padStart(3, '0'), ispb: bank.ispb }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return NextResponse.json({ banks });
  } catch {
    return NextResponse.json({ error: 'Lista de bancos indisponível. Você pode informar a instituição manualmente ou continuar sem banco.' }, { status: 503 });
  }
}
