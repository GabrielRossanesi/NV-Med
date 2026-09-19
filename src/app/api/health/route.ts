import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/isConfigured';

export async function GET() {
  const configured = isSupabaseConfigured();

  if (!configured) {
    return NextResponse.json({
      status: 'offline_mode',
      database: 'local_fallback',
      supabaseConfigured: false,
      message: 'Supabase não configurado. O sistema está operando no modo demonstração com persistência local.',
      region: 'São Paulo (sa-east-1) pendente de conexão'
    });
  }

  try {
    const supabase = await createClient();
    if (!supabase) throw new Error('Cliente Supabase não inicializado');

    const { count, error } = await supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    return NextResponse.json({
      status: 'online',
      database: 'supabase',
      region: 'São Paulo (sa-east-1)',
      supabaseConfigured: true,
      connected: true,
      organizationsCount: count,
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json(
      {
        status: 'error',
        connected: false,
        supabaseConfigured: true,
        error: message
      },
      { status: 500 }
    );
  }
}
