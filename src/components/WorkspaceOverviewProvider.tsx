'use client';
import { createContext,useCallback,useContext,useEffect,useState } from 'react';
import { usePathname } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { canViewPermission } from '@/lib/permissions';
import type { DocumentOverview,FinanceOverview } from '@/lib/workspaceOverview';
type Snapshot<T>={key?:string;data?:T;error?:string};
type Overview={documents:Snapshot<DocumentOverview>;finance:Snapshot<FinanceOverview>;reload:()=>void};
const Context=createContext<Overview>({documents:{},finance:{},reload:()=>{}});
export const useWorkspaceOverview=()=>useContext(Context);
function CompanyOverview({children}:{children:React.ReactNode}){
 const org=useStore(state=>state.activeOrganizationId),user=useStore(state=>state.currentUser),revision=useStore(state=>state.workspaceRevision);
 const alertEnabled=useStore(state=>state.accountPreferences.documentAlerts);
 const pathname=usePathname();
 const [documents,setDocuments]=useState<Snapshot<DocumentOverview>>({}),[finance,setFinance]=useState<Snapshot<FinanceOverview>>({});
 const [refresh,setRefresh]=useState(0);const reload=useCallback(()=>setRefresh(value=>value+1),[]);
 const key=`${org}/${revision}/${refresh}`;
 const needDocuments=(alertEnabled&&canViewPermission(user,'documentos'))||pathname==='/dashboard'&&canViewPermission(user,'documentos')||pathname==='/escala'&&canViewPermission(user,'escala');
 const needFinance=pathname==='/dashboard'&&canViewPermission(user,'financeiro');
 useEffect(()=>{
  if(!org||!needDocuments)return;let active=true;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25_000);
  void fetch('/api/workspace/overview?'+new URLSearchParams({org,part:'documents'}),{cache:'no-store',signal:controller.signal}).then(async result=>{if(!result.ok)throw new Error();const data=await result.json() as DocumentOverview;if(active)setDocuments({key,data});}).catch(()=>{if(active)setDocuments({key,error:'Não foi possível consultar a documentação.'});}).finally(()=>clearTimeout(timeout));
  return()=>{active=false;controller.abort();clearTimeout(timeout);};
 },[org,needDocuments,key]);
 useEffect(()=>{
  if(!org||!needFinance)return;let active=true;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25_000);
  void fetch('/api/workspace/overview?'+new URLSearchParams({org,part:'finance'}),{cache:'no-store',signal:controller.signal}).then(async result=>{if(!result.ok)throw new Error();const data=await result.json() as FinanceOverview;if(active)setFinance({key,data});}).catch(()=>{if(active)setFinance({key,error:'Não foi possível consultar o resumo financeiro.'});}).finally(()=>clearTimeout(timeout));
  return()=>{active=false;controller.abort();clearTimeout(timeout);};
 },[org,needFinance,key]);
 return <Context.Provider value={{documents:documents.key===key?documents:{},finance:finance.key===key?finance:{},reload}}>{children}</Context.Provider>;
}
export default function WorkspaceOverviewProvider({children}:{children:React.ReactNode}){
 const org=useStore(state=>state.activeOrganizationId),user=useStore(state=>state.currentUser.id);
 return <CompanyOverview key={`${user}/${org}`}>{children}</CompanyOverview>;
}
