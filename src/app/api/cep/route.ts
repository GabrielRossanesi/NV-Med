import { doctorAddressFieldLimits, normalizeDoctorCep, type CepAddress } from '../../../lib/doctorAddress.ts';
import { crmStates } from '../../../lib/documentRequirements.ts';

export async function GET(request: Request) {
  const cep = normalizeDoctorCep(new URL(request.url).searchParams.get('cep') ?? '');
  if (!cep) return Response.json({ error: 'Informe um CEP de oito dígitos.' }, { status: 400 });

  try {
    // The provider receives only the postal code. Reuse public lookup results.
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error('ViaCEP lookup failed');
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object') throw new Error('Invalid ViaCEP response');
    if ('erro' in result && (result.erro === true || result.erro === 'true')) {
      return Response.json({ error: 'CEP não encontrado.' }, { status: 404 });
    }
    if (!('cep' in result) || typeof result.cep !== 'string' || normalizeDoctorCep(result.cep) !== cep) {
      throw new Error('Unexpected ViaCEP postal code');
    }

    const address: CepAddress = {
      street: 'logradouro' in result && typeof result.logradouro === 'string' ? result.logradouro.trim() : '',
      district: 'bairro' in result && typeof result.bairro === 'string' ? result.bairro.trim() : '',
      city: 'localidade' in result && typeof result.localidade === 'string' ? result.localidade.trim() : '',
      state: 'uf' in result && typeof result.uf === 'string' && crmStates.includes(result.uf) ? result.uf : '',
    };
    if ((Object.keys(address) as (keyof CepAddress)[]).some(field =>
      /[\r\n]/.test(address[field]) || address[field].length > doctorAddressFieldLimits[field])) {
      throw new Error('Invalid ViaCEP address fields');
    }
    return Response.json(address);
  } catch {
    return Response.json({ error: 'Consulta de CEP indisponível.' }, { status: 503 });
  }
}
