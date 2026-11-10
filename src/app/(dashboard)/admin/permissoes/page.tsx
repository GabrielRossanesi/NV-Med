'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ADDITIONAL_PERMISSION_MODULES, permissionActionLabels, roleHasAction, roleHasPermission, SAAS_ROLES, TENANT_ROLES } from '@/lib/permissions';
import AccessGuard from '@/components/AccessGuard';
import { Shield, Check, X, Building, HelpCircle } from 'lucide-react';

export default function AdminPermissionsPage() {
  const [activeTab, setActiveTab] = useState<'tenant' | 'saas'>('tenant');

  const clientRoles = TENANT_ROLES;
  const clientModules = ADDITIONAL_PERMISSION_MODULES.map(module => ({ ...module, name: module.label }));
  const saasRoles = SAAS_ROLES;
  const saasModules = [
    { key: 'admin', name: 'Dashboard SaaS' },
    { key: 'empresas', name: 'Gestão de empresas' },
    { key: 'usuarios', name: 'Gestão de usuários' },
    { key: 'permissoes', name: 'Matriz de permissões' },
    { key: 'simular_acesso', name: 'Simulação de acesso' },
  ];

  return (
    <AccessGuard requiredPermission="permissoes">
      <div className="space-y-8 animate-in fade-in duration-300">
        {/* Title */}
        <div>
          <h2 className="nv-page-title flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Matriz de Permissões (RBAC)
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Ações padrão por cargo. Consulte as exceções e os limites de delegação na ficha de cada usuário.
          </p>
          <Link href="/admin/usuarios" className="nv-button-secondary mt-4">Gerenciar permissões por usuário</Link>
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
        <div className="nv-panel overflow-hidden">
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
              <span className="flex items-center gap-1 text-success font-semibold">
                <span className="h-4 w-4 bg-success/10 rounded flex items-center justify-center"><Check className="h-3 w-3" /></span> Autorizado
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
                    <tr key={module.key} className="hover:bg-table-row-hover transition-colors duration-150">
                      <td className="p-4 font-semibold text-text-secondary">
                        {module.name}
                      </td>
                      {clientRoles.map(role => {
                        const allowed = roleHasPermission('tenant_user', role, module.key);
                        const actions = module.actions.filter(action => roleHasAction('tenant_user', role, module.key, action));
                        return (
                          <td key={role} className="p-4 text-center">
                            <div className="flex justify-center">
                              {allowed ? (
                                <div title={actions.map(action => permissionActionLabels[action]).join(' · ')} className="h-6 w-6 rounded-lg bg-success/10 text-success flex items-center justify-center">
                                  <Check className="h-3.5 w-3.5" />
                                  <span className="sr-only">{actions.map(action => permissionActionLabels[action]).join(', ')}</span>
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
                    <tr key={module.key} className="hover:bg-table-row-hover transition-colors duration-150">
                      <td className="p-4 font-semibold text-text-secondary">
                        {module.name}
                      </td>
                      {saasRoles.map(role => {
                        const allowed = roleHasPermission('saas_admin', role, module.key);
                        return (
                          <td key={role} className="p-4 text-center">
                            <div className="flex justify-center">
                              {allowed ? (
                                <div className="h-6 w-6 rounded-lg bg-success/10 text-success flex items-center justify-center">
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
              As permissões individuais podem alterar o padrão exibido. O servidor e o banco consultam o acesso efetivo a cada ação. O cargo Coordenador Médico usa as mesmas permissões do médico no portal.
            </p>
          </div>
        </div>
      </div>
    </AccessGuard>
  );
}
