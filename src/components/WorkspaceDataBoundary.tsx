'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { fetchWorkspaceData } from '@/services/supabaseService';
import { workspacePlan, type WorkspacePeriod, type WorkspacePeriods } from '@/lib/workspaceScope';

type PeriodRequest=(slot:string,range:WorkspacePeriod|undefined)=>void;
const PeriodContext=createContext<PeriodRequest>(()=>{});
export function useWorkspacePeriod(slot:string,range:WorkspacePeriod) {
  const request=useContext(PeriodContext);
  const start=range?.start,end=range?.end;
  useEffect(()=>{request(slot,start&&end?{start,end}:null);return()=>request(slot,undefined);},[request,slot,start,end]);
}
const unavailable=async()=>{throw new Error('Atualize a tela para consultar os dados atuais.');};
function Loading(){return <p role="status" className="py-6 text-sm text-text-secondary">Carregando dados da tela…</p>;}
function Scope({children,path,organizationId}:{children:React.ReactNode;path:string;organizationId:string}) {
  const params=useSearchParams();
  const user=useStore(state=>state.currentUser);
  const [periods,setPeriods]=useState<WorkspacePeriods>({});
  const requestPeriod=useCallback<PeriodRequest>((slot,range)=>setPeriods(current=>{
    if(JSON.stringify(current[slot])===JSON.stringify(range))return current;
    const next={...current};if(range===undefined)delete next[slot];else next[slot]=range;return next;
  }),[]);
  const planKey=JSON.stringify(workspacePlan(path,new URLSearchParams(params.toString()),organizationId,periods));
  const [state,setState]=useState({key:'',initialized:false,pending:true,error:''});
  const sequence=useRef(0),alive=useRef(false),controller=useRef<AbortController|null>(null);
  const lastFocus=useRef<HTMLElement|null>(null);
  const load=useCallback(async()=>{
    const token=++sequence.current;
    controller.current?.abort();const abort=new AbortController();controller.current=abort;
    const timeout=setTimeout(()=>abort.abort(),25_000);
    setState(previous=>({...previous,pending:true,error:''}));
    try {
      const data=await fetchWorkspaceData(JSON.parse(planKey),user,abort.signal);
      if(alive.current&&sequence.current===token&&useStore.getState().currentUser.id===user.id&&useStore.getState().activeOrganizationId===organizationId){
        useStore.getState().syncWorkspace(data);setState({key:planKey,initialized:true,pending:false,error:''});
      }
    } catch(failure){
      const cancelled=abort.signal.aborted;abort.abort();
      if(alive.current&&sequence.current===token)setState(previous=>({...previous,pending:false,error:cancelled?'O carregamento demorou demais. Tente novamente.':failure instanceof Error?failure.message:'Não foi possível carregar esta tela.'}));
      throw failure;
    } finally{clearTimeout(timeout);}
  },[planKey,user,organizationId]);
  useEffect(()=>{
    alive.current=true;useStore.setState({refreshWorkspace:load});void load().catch(()=>{});
    return()=>{alive.current=false;controller.current?.abort();if(useStore.getState().refreshWorkspace===load)useStore.setState({refreshWorkspace:unavailable});};
  },[load]);
  const pending=state.pending||state.key!==planKey;
  useEffect(()=>{
    if(!pending&&!state.error&&lastFocus.current?.isConnected&&document.activeElement===document.body)lastFocus.current.focus({preventScroll:true});
  },[pending,state.error]);
  return <PeriodContext.Provider value={requestPeriod}>
    {state.error?<div className="nv-panel space-y-3 p-5"><p role="alert">{state.error}</p><button type="button" className="nv-button-secondary" onClick={()=>void load().catch(()=>{})}>Tentar novamente</button></div>:pending&&<Loading/>}
    {state.initialized&&<div onFocusCapture={event=>{lastFocus.current=event.target as HTMLElement;}} aria-busy={pending} aria-hidden={pending||Boolean(state.error)} inert={pending||Boolean(state.error)} style={pending||state.error?{visibility:'hidden',height:0,overflow:'hidden'}:undefined}>{children}</div>}
  </PeriodContext.Provider>;
}
function WorkspaceScope({children}:{children:React.ReactNode}) {
  const path=usePathname(),organizationId=useStore(state=>state.activeOrganizationId),user=useStore(state=>state.currentUser.id);
  return <Scope key={`${user}/${organizationId}/${path}`} path={path} organizationId={organizationId}>{children}</Scope>;
}
export default function WorkspaceDataBoundary({children}:{children:React.ReactNode}){
  return <Suspense fallback={<Loading/>}><WorkspaceScope>{children}</WorkspaceScope></Suspense>;
}
