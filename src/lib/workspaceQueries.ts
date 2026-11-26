import type { SupabaseClient } from '@supabase/supabase-js';
export async function workspaceDocuments<T extends {id:string}>(client:SupabaseClient,org:string,target:string|null=null,signal?:AbortSignal):Promise<T[]>{
 const rows:T[]=[];let after:string|null=null;
 for(;;){
  let request=client.rpc('nv_workspace_documents',{org,target,after_id:after,page_limit:500});if(signal)request=request.abortSignal(signal);
  const {data,error}=await request;if(error||!Array.isArray(data))throw new Error('Não foi possível carregar os documentos. Tente novamente.');
  const batch=data as T[];rows.push(...batch);if(batch.length<500)return rows;
  const next=batch.at(-1)!.id;if(typeof next!=='string'||after!==null&&next<=after)throw new Error('Não foi possível concluir a leitura dos documentos.');after=next;
 }
}
