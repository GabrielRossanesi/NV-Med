'use client';

import { useStore } from '@/store/useStore';
import { X, Shield, Check, Building } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ProfileSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfileSelectorModal({ isOpen, onClose }: ProfileSelectorModalProps) {
  const router = useRouter();
  const { users, currentUser, setCurrentUser, organizations } = useStore();

  if (!isOpen) return null;

  // Split users into SaaS admins and Tenant users (demo profiles)
  // To keep it clean and match the 12 requested profiles, we filter based on IDs or roles
  const saasProfiles = users.filter((u) => u.type === 'saas_admin').slice(0, 6);
  const tenantProfiles = users.filter((u) => u.type === 'tenant_user').slice(0, 6);

  const handleSelectProfile = (userId: string, type: 'saas_admin' | 'tenant_user') => {
    setCurrentUser(userId);
    onClose();
    if (type === 'saas_admin') {
      router.push('/admin');
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-2xl bg-card-bg border border-border rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Seletor de Perfil Ativo (Demo)
            </h3>
            <p className="text-xs text-text-muted mt-1">
              Simule a experiência de diferentes cargos e permissões na plataforma.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-muted transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* SaaS Admins Group */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-3 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Administração Geral (SaaS Admin)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {saasProfiles.map((profile) => {
                const isSelected = currentUser.id === profile.id;
                return (
                  <button
                    key={profile.id}
                    onClick={() => handleSelectProfile(profile.id, 'saas_admin')}
                    className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition duration-200 cursor-pointer ${
                      isSelected
                        ? 'bg-primary/5 border-primary shadow-glow-primary'
                        : 'border-border bg-surface-muted/50 hover:bg-state-hover hover:border-border-strong'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs ${
                        isSelected ? 'bg-primary text-text-inverse' : 'bg-primary/10 text-primary'
                      }`}>
                        {profile.name.split(' ').map((n) => n[0]).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{profile.name}</p>
                        <p className="text-xs text-text-muted">{profile.role}</p>
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tenant Users Group */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-500 mb-3 flex items-center gap-1.5">
              <Building className="h-3.5 w-3.5" />
              Equipe da Empresa Cliente (Tenant)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tenantProfiles.map((profile) => {
                const isSelected = currentUser.id === profile.id;
                const org = organizations.find((o) => o.id === profile.organizationId);
                return (
                  <button
                    key={profile.id}
                    onClick={() => handleSelectProfile(profile.id, 'tenant_user')}
                    className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition duration-200 cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/5 border-amber-500 shadow-sm shadow-amber-500/10'
                        : 'border-border bg-surface-muted/50 hover:bg-state-hover hover:border-border-strong'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs ${
                        isSelected ? 'bg-amber-500 text-white' : 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
                      }`}>
                        {profile.name.split(' ').map((n) => n[0]).join('')}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{profile.name}</p>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5 mt-0.5">
                          <span className="text-xs text-text-secondary">{profile.role}</span>
                          <span className="hidden sm:inline text-text-muted text-[10px]">•</span>
                          <span className="text-[10px] text-text-muted truncate max-w-[120px]">{org?.name}</span>
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-amber-500 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-surface-muted p-4 border-t border-border text-center text-[10px] text-text-muted">
          As permissões do menu e o acesso a dados serão ajustados de forma automática e imediata ao selecionar o perfil.
        </div>
      </div>
    </div>
  );
}
