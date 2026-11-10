import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function redirectAfterAuth(destination: URL) {
  const response = NextResponse.redirect(destination);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  const code = request.nextUrl.searchParams.get('code');
  if (code || (token_hash && (type === 'signup' || type === 'email'))) {
    const client = await createClient();
    if (client) {
      const { error } = code
        ? await client.auth.exchangeCodeForSession(code)
        : await client.auth.verifyOtp({ token_hash: token_hash!, type: type === 'signup' ? 'signup' : 'email' });
      if (!error) {
        const portal = new URL('/portal', request.url);
        const organization = request.nextUrl.searchParams.get('empresa');
        if (organization && /^[a-zA-Z0-9_-]{1,100}$/.test(organization)) portal.searchParams.set('empresa', organization);
        return redirectAfterAuth(portal);
      }
    }
  }
  if (token_hash && (type === 'invite' || type === 'recovery')) {
    const client = await createClient();
    if (client) {
      const { error } = await client.auth.verifyOtp({ token_hash, type });
      if (!error) return redirectAfterAuth(new URL('/definir-senha', request.url));
    }
  }
  return redirectAfterAuth(new URL('/login?error=link-expirado', request.url));
}
