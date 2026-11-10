import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { maxMedicalFileBytes, medicalFileExtension } from '@/lib/medicalFile';
import { isMedicalDocumentPath, readBoundedBody } from '@/lib/documentAccess';

const bucket = 'medical-documents';
const maxRequestBytes = maxMedicalFileBytes + 10_000;
const noCache = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noCache });
}

async function documentAccess(id: string, operation: 'read' | 'write', revision: string | null = null) {
  if (!id || id.length > 200) return null;
  const client = await createClient();
  if (!client) return null;
  const user = await getAuthorizedUser(client);
  if (!user) return null;
  const { data } = await client.rpc('nv_portal_document_target', { target: id, operation, revision }).maybeSingle<{
    doctor_id: string; organization_id: string; file_path: string | null;
  }>();
  return data ? { client, user, document: data } : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const revision = request.nextUrl.searchParams.get('revision');
  if (revision !== null && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(revision)) {
    return failure('Arquivo indisponível.', 404);
  }
  const access = await documentAccess(id, 'read', revision);
  if (!access) return failure('Arquivo indisponível.', 404);
  const { file_path, organization_id, doctor_id } = access.document;
  if (!file_path || !isMedicalDocumentPath(file_path, organization_id, doctor_id)) return failure('Arquivo indisponível.', 404);
  const admin = createAdminClient();
  if (!admin) return failure('Armazenamento indisponível.', 503);
  const preview = request.nextUrl.searchParams.get('preview') === '1';
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(file_path, 60, { download: !preview });
  if (error) return failure('Arquivo indisponível.', 404);
  if (preview) return NextResponse.json({ url: data.signedUrl }, { headers: noCache });
  return NextResponse.redirect(data.signedUrl, { headers: noCache });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return failure('Origem inválida.', 403);
  if (Number(request.headers.get('content-length')) > maxRequestBytes) return failure('O limite por arquivo é de 4 MB.', 413);
  const contentType = request.headers.get('content-type');
  if (!contentType || !/^multipart\/form-data;/i.test(contentType)) return failure('Envie um formulário de arquivo.', 415);
  const { id } = await params;
  const access = await documentAccess(id, 'write');
  if (!access) return failure('Documento indisponível.', 404);
  const { data: verified } = await access.client.auth.getClaims();
  const session = verified?.claims.session_id;
  if (!session) return failure('Documento indisponível.', 404);
  const admin = createAdminClient();
  if (!admin) return failure('Armazenamento indisponível.', 503);
  const { data: reserved, error: quotaError } = await access.client.rpc('nv_reserve_document_upload');
  if (quotaError) return failure('Envio temporariamente indisponível.', 503);
  if (reserved !== true) return NextResponse.json({ error: 'Limite de envios atingido. Tente novamente em alguns minutos.' },
    { status: 429, headers: { ...noCache, 'Retry-After': '600' } });
  const body = await readBoundedBody(request, maxRequestBytes).catch(() => undefined);
  if (body === null) return failure('O limite por arquivo é de 4 MB.', 413);
  const form = body && await new Response(body, { headers: { 'Content-Type': contentType } }).formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0 || form?.getAll('file').length !== 1) return failure('Envie um único arquivo.', 400);
  if (file.size > maxMedicalFileBytes) return failure('O limite por arquivo é de 4 MB.', 413);
  const kind = await medicalFileExtension(file);
  if (!kind) return failure('Envie um arquivo PDF, JPEG ou PNG válido.', 415);
  const path = [access.document.organization_id, access.document.doctor_id, crypto.randomUUID() + '.' + kind].join('/');
  if (!isMedicalDocumentPath(path, access.document.organization_id, access.document.doctor_id)) return failure('Pasta indisponível.', 404);
  const storage = admin.storage.from(bucket);
  const { error: uploadError } = await storage.upload(path, file, { upsert: false, contentType: file.type, cacheControl: '0' });
  if (uploadError) return failure('Não foi possível armazenar o arquivo.', 502);
  const { data, error } = await admin.rpc('nv_save_portal_document', {
    actor: access.user.id, target: id, path, filename: file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 200),
    previous_path: access.document.file_path,
    actor_session: session,
  });
  if (error || !data) {
    // A transport failure can leave the write outcome unknown. Keep the object until it can be reconciled.
    if (!error) await storage.remove([path]);
    return failure('Não foi possível confirmar o envio do documento.', 409);
  }
  return NextResponse.json({ saved: true }, { status: 201, headers: noCache });
}
