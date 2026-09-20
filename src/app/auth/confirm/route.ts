import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  if (token_hash && (type === 'invite' || type === 'recovery')) {
    const client = await createClient();
    if (client) { const { error } = await client.auth.verifyOtp({ token_hash, type }); if (!error) return NextResponse.redirect(new URL('/definir-senha', request.url)); }
  }
  return NextResponse.redirect(new URL('/login?error=link-expirado', request.url));
}
