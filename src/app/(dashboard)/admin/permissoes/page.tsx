'use client';

import { useState } from 'react';
import AccessGuard from '@/components/AccessGuard';
import { Shield, Check, X, Building, HelpCircle } from 'lucide-react';

export default function AdminPermissionsPage() {
  const [activeTab, setActiveTab] = useState<'tenant' | 'saas'>('tenant');

  // Tenant/Client Roles & Modules Permissions representation
  const clientRoles = ['Diretor', 'Gerente', 'Coordenador de Escalas', 'Escalista', 'Financeiro', 'Jurídico'];
  const clientModules = [
    { key: 'dashboard', name: 'Dashboard' },
    { key: 'medicos', name: 'Médicos (Corpo Clínico)' },
    { key: 'unidades', name: 'Unidades de Atendimento' },
    { key: 'documentos', name: 'Documentos & Compliance' },
    { key: 'escala', name: 'Escala de Plantões' },
    { key: 'configuracoes', name: 'Configurações da Empresa' },
    { key: 'financeiro', name: 'Financeiro / Relatórios' },
  ];

  // Map representing checks for Client roles
  // [role][module] -> boolean (true: allowed, false: blocked)
  const clientMatrix: Record<string, Record<string, boolean>> = {
    'Diretor': { dashboard: true, medicos: true, unidades: true, documentos: true, escala: true, configuracoes: true, financeiro: true },
    'Gerente': { dashboard: true, medicos: true, unidades: true, documentos: true, escala: true, configuracoes: false, financeiro: true },
    'Coordenador de Escalas': { dashboard: true, medicos: true, unidades: true, documentos: true, escala: true, configuracoes: false, financeiro: false },
    'Escalista': { dashboard: true, medicos: true, unidades: true, documentos: false, escala: true, configuracoes: false, financeiro: false },
    'Financeiro': { dashboard: true, medicos: true, unidades: true, documentos: false, escala: true, configuracoes: false, financeiro: true },
    'Jurídico': { dashboard: true, medicos: true, unidades: false, documentos: true, escala: false, configuracoes: false, financeiro: false },
  };

  // SaaS Admin Roles & SaaS Modules Permissions representation
  const saasRoles = ['CEO', 'Gerente', 'Coordenador', 'Administrativo', 'Financeiro', 'Jurídico'];
  const saasModules = [
    { key: 'admin', name: 'Dashboard SaaS Admin' },
    { key: 'empresas', name: 'Gestão de Empresas (Tenants)' },
    { key: 'usuarios', name: 'Gestão de Usuários (Acessos)' },
    { key: 'permissoes', name: 'Matriz de Permissões (RBAC)' },
    { key: 'planos', name: 'Gestão de Planos & Preços' },
    { key: 'simular_acesso', name: 'Simulação de Acesso (Login Tenant)' },
    { key: 'auditoria', name: 'Logs de Auditoria' },
    { key: 'suporte', name: 'Suporte Técnico' },
  ];

  const saasMatrix: Record<string, Record<string, boolean>> = {
    'CEO': { admin: true, empresas: true, usuarios: true, permissoes: true, planos: true, simular_acesso: true, auditoria: true, suporte: true },
    'Gerente': { admin: true, empresas: true, usuarios: true, permissoes: false, planos: true, simular_acesso: true, auditoria: true, suporte: true },
    'Coordenador': { admin: true, empresas: true, usuarios: true, permissoes: false, planos: false, simular_acesso: false, auditoria: true, suporte: true },
    'Administrativo': { admin: true, empresas: true, usuarios: true, permissoes: false, planos: false, simular_acesso: false, auditoria: false, suporte: true },
    'Financeiro': { admin: true, empresas: true, usuarios: false, permissoes: false, planos: true, simular_acesso: false, auditoria: false, suporte: false },
    'Jurídico': { admin: true, empresas: true, usuarios: false, permissoes: false, planos: false, simular_acesso: false, auditoria: true, suporte: false },
  };

  return (
    <AccessGuard requiredPermission="permissoes">
      <div className="space-y-8 animate-in fade-in duration-300">
        {/* Title */}
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Matriz de Permissões (RBAC)
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Visualização das regras de controle de acesso baseado em cargos (RBAC) da plataforma NV Med.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('tenant')}
            className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'tenant'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Building className="h-4 w-4" />
            Permissões da Empresa Cliente
          </button>
          <button
            onClick={() => setActiveTab('saas')}
            className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'saas'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            <Shield className="h-4 w-4" />
            Permissões Admin SaaS
          </button>
        </div>

        {/* Matrix Card */}
        <div className="bg-card-bg border border-border rounded-2xl shadow-soft overflow-hidden">
          <div className="p-5 border-b border-border bg-surface-muted/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-text-primary">
                {activeTab === 'tenant' ? 'Matriz Operacional de Clientes' : 'Matriz de Acessos SaaS Corporativo'}
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                {activeTab === 'tenant' 
                  ? 'Representa as permissões de acesso às áreas das clínicas e hospitais vinculados.' 
                  : 'Representa as permissões de equipe interna do NV Med.'
                }
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-500 font-semibold">
                <span className="h-4 w-4 bg-emerald-500/10 rounded flex items-center justify-center"><Check className="h-3 w-3" /></span> Autorizado
              </span>
              <span className="flex items-center gap-1 text-danger font-semibold">
                <span className="h-4 w-4 bg-danger/10 rounded flex items-center justify-center"><X className="h-3 w-3" /></span> Bloqueado
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-muted/20 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  <th className="p-4 w-1/3">Módulo / Recurso</th>
                  {activeTab === 'tenant' ? (
                    clientRoles.map(role => (
                      <th key={role} className="p-4 text-center">{role}</th>
                    ))
                  ) : (
                    saasRoles.map(role => (
                      <th key={role} className="p-4 text-center">{role}</th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {activeTab === 'tenant' ? (
                  clientModules.map(module => (
                    <tr key={module.key} className="hover:bg-state-hover transition duration-150">
                      <td className="p-4 font-semibold text-text-secondary">
                        {module.name}
                      </td>
                      {clientRoles.map(role => {
                        const allowed = clientMatrix[role]?.[module.key] ?? false;
                        return (
                          <td key={role} className="p-4 text-center">
                            <div className="flex justify-center">
                              {allowed ? (
                                <div className="h-6 w-6 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 flex items-center justify-center">
                                  <Check className="h-3.5 w-3.5" />
                                </div>
                              ) : (
                                <div className="h-6 w-6 rounded-lg bg-danger/10 text-danger flex items-center justify-center">
                                  <X className="h-3.5 w-3.5" />
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                ) : (
                  saasModules.map(module => (
                    <tr key={module.key} className="hover:bg-state-hover transition duration-150">
                      <td className="p-4 font-semibold text-text-secondary">
                        {module.name}
                      </td>
                      {saasRoles.map(role => {
                        const allowed = saasMatrix[role]?.[module.key] ?? false;
                        return (
                          <td key={role} className="p-4 text-center">
                            <div className="flex justify-center">
                              {allowed ? (
                                <div className="h-6 w-6 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 flex items-center justify-center">
                                  <Check className="h-3.5 w-3.5" />
                                </div>
                              ) : (
                                <div className="h-6 w-6 rounded-lg bg-danger/10 text-danger flex items-center justify-center">
                                  <X className="h-3.5 w-3.5" />
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info Explanatory Banner */}
        <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-3">
          <HelpCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-text-primary">Sobre o Controle de Acesso (RBAC)</p>
            <p className="text-text-muted">
              Esta matriz é lida pelo componente <code className="bg-surface-muted text-text-primary px-1 py-0.5 rounded font-mono">AccessGuard</code> e pela barra de navegação para habilitar, desabilitar ou ocultar abas e ações em toda a interface do NV Med, garantindo segurança e conformidade operacional de inquilinatos.
            </p>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
