import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/isConfigured';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const publicPath = ['/login', '/definir-senha', '/auth/confirm'].includes(request.nextUrl.pathname);
  if (!isSupabaseConfigured()) return publicPath ? response : NextResponse.redirect(new URL('/login', request.url));
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data, error } = await client.auth.getUser();
  if ((!data.user || error) && !publicPath) {
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/', '/login', '/definir-senha', '/auth/confirm', '/dashboard/:path*', '/escala/:path*', '/medicos/:path*', '/unidades/:path*', '/documentos/:path*', '/financeiro/:path*', '/relatorios/:path*', '/configuracoes/:path*', '/perfil/:path*', '/empresas/:path*', '/admin/:path*'] };
