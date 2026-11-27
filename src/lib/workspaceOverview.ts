import type { doctorsWithDocumentIssues, dashboardPayments } from './dashboardOverview';
export type DocumentOverview={issues:(Omit<ReturnType<typeof doctorsWithDocumentIssues>[number],'doctor'>&{doctor:{id:string;name:string;specialty:string}})[];schedule:Record<string,{warning:boolean;blocked:boolean}>;units:Record<string,string[]>};
export type FinanceOverview=ReturnType<typeof dashboardPayments>;
export type OperationalCounts={today:string;enrollments:number|null;exchanges:number|null;applications:number|null;checkins_pending:number|null};
