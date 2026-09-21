'use client';

import { useStore } from '@/store/useStore';
import { ShieldAlert, ArrowLeft, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { canViewPermission, ROLE_PERMISSIONS } from '@/lib/permissions';

export { ROLE_PERMISSIONS } from '@/lib/permissions';

interface AccessGuardProps {
  requiredPermission: string;
  children: React.ReactNode;
}

export default function AccessGuard({ requiredPermission, children }: AccessGuardProps) {
  const { currentUser, isSimulating } = useStore();
  const router = useRouter();


  const userPermissions = ROLE_PERMISSIONS[`${currentUser.type}:${currentUser.role}`] || [];
  
  // A SaaS Admin has access to their normal SaaS features.
  // If they are simulating, they also get access to operational tenant features.
  let hasAccess = canViewPermission(currentUser, requiredPermission);
  
  if (currentUser.type === 'saas_admin') {
    if (requiredPermission === 'admin' || requiredPermission === 'empresas' || requiredPermission === 'usuarios' || requiredPermission === 'permissoes') {
      hasAccess = userPermissions.includes(requiredPermission);
    } else {
      // For operational pages like medicos/escala, SaaS admin has access if they are simulating
      hasAccess = isSimulating || userPermissions.includes(requiredPermission);
    }
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center animate-in fade-in duration-300">
        <div className="h-16 w-16 bg-danger/10 text-danger rounded-2xl flex items-center justify-center mb-6 shadow-sm">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h3 className="text-xl font-bold text-text-primary">Acesso Restrito</h3>
        <p className="text-sm text-text-muted mt-2 max-w-md">
          Você está logado como <strong className="text-text-primary">{currentUser.name}</strong> ({currentUser.role}). 
          Seu cargo atual não possui permissões para acessar esta área ({requiredPermission}).
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-8">
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold border border-border bg-card-bg hover:bg-state-hover text-text-primary rounded-xl transition cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          
          <Link
            href={currentUser.type === 'saas_admin' ? '/admin' : '/dashboard'}
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-text-inverse hover:bg-primary-hover rounded-xl shadow-glow-primary transition cursor-pointer"
          >
            <LayoutDashboard className="h-4 w-4" />
            Painel Principal
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
