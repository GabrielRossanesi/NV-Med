import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET() {
  const client = await createClient();
  if (!client) return NextResponse.json({status:'unconfigured'}, {status:503});
  const { data: {user} } = await client.auth.getUser();
  if (!user) return NextResponse.json({error:'Não autenticado'}, {status:401});
  const {data,error}=await client.from('user_accounts').select('id').eq('auth_user_id',user.id).eq('status','active').single();
  return NextResponse.json({status: !error && data ? 'online' : 'unavailable'}, {status: !error && data ? 200 : 403, headers:{'Cache-Control':'no-store'}});
}
