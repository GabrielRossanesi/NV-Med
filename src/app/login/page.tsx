'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { Activity, ShieldCheck, Building, ArrowRight, Sun, Moon } from 'lucide-react';
import AppBackground from '@/components/AppBackground';

export default function LoginPage() {
  const router = useRouter();
  const { organizations, setActiveOrganizationId, theme, setTheme } = useStore();
  const [selectedOrgId, setSelectedOrgId] = useState('org-1');
  const [username, setUsername] = useState('admin@nvmed.com');
  const [password, setPassword] = useState('••••••••');
  const [isLoading, setIsLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const hydrate = async () => {
      await useStore.persist.rehydrate();
      setHydrated(true);
    };
    hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [theme, hydrated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Simulate network delay
    setTimeout(() => {
      setActiveOrganizationId(selectedOrgId);
      setIsLoading(false);
      router.push('/dashboard');
    }, 800);
  };

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050607]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-teal-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex text-text-primary transition-colors duration-300 relative">
      <AppBackground />

      {/* Left side: Premium branding poster */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-surface-muted/5 flex-col justify-between p-12 overflow-hidden border-r border-border">
        {/* Logo and Brand */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="bg-primary text-text-inverse p-2 rounded-xl shadow-glow-primary">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xl font-bold text-text-primary tracking-tight">NV Med</span>
            <span className="block text-[10px] text-primary font-bold uppercase tracking-wider">Medical SaaS Platform</span>
          </div>
        </div>

        {/* Big Idea Quote/Heading */}
        <div className="relative z-10 my-auto max-w-md">
          <h2 className="text-4xl font-extrabold text-text-primary leading-tight tracking-tight mb-4">
            Gestão médica inteligente e multiempresas.
          </h2>
          <p className="text-text-secondary text-sm leading-relaxed">
            Monitore escalas, centralize a documentação de conformidade do CRM, gerencie unidades de pronto atendimento e otimize plantões em tempo real.
          </p>
        </div>

        {/* Footer info */}
        <div className="relative z-10 flex items-center justify-between text-xs text-text-muted">
          <span>NV Med Operações Ltda © 2026</span>
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="h-4 w-4 text-success" />
            Conexão Criptografada SSL
          </span>
        </div>
      </div>

      {/* Right side: Login form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-12 relative bg-transparent">
        {/* Theme Toggle Button */}
        <div className="absolute top-4 right-4">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-full border border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-state-hover transition cursor-pointer shadow-soft"
            title={theme === 'dark' ? 'Alternar para Tema Claro' : 'Alternar para Tema Escuro'}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 text-primary" />
            ) : (
              <Moon className="h-4 w-4 text-primary" />
            )}
          </button>
        </div>

        <div className="max-w-md w-full mx-auto relative z-10">
          {/* Logo mobile */}
          <div className="flex items-center gap-3 lg:hidden mb-8">
            <div className="bg-primary text-text-inverse p-2 rounded-xl shadow-glow-primary">
              <Activity className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold text-text-primary tracking-tight">NV Med</span>
          </div>

          <div className="mb-8">
            <h3 className="text-2xl font-bold text-text-primary tracking-tight">Acesse sua conta</h3>
            <p className="text-text-secondary text-sm mt-1">
              Selecione a empresa padrão da simulação para prosseguir para o dashboard.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Simulation Company Picker */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Selecione a Empresa (Simulação)
              </label>
              <div className="grid grid-cols-1 gap-2.5">
                {organizations.map((org) => {
                  const isSelected = selectedOrgId === org.id;
                  return (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setSelectedOrgId(org.id)}
                      className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition duration-150 cursor-pointer ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-text-primary'
                          : 'border-border bg-surface/60 hover:bg-state-hover text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Building className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-text-muted'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{org.name}</p>
                          <p className="text-[10px] text-text-muted truncate">{org.address ? (org.address.split(',')[2] || org.address) : ''}</p>
                        </div>
                      </div>
                      {isSelected && (
                        <span className="h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/20" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Email (Simulated input) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Usuário / E-mail
              </label>
              <input
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-input-bg border border-input-border rounded-xl px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-primary transition"
              />
            </div>

            {/* Password (Simulated input) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-input-bg border border-input-border rounded-xl px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-primary transition"
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary hover:bg-primary-hover text-text-inverse rounded-xl py-3.5 px-4 font-semibold text-sm flex items-center justify-center gap-2 transition duration-200 disabled:opacity-55 cursor-pointer"
            >
              {isLoading ? (
                <span className="h-4 w-4 border-2 border-text-inverse border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Entrar no NV Med Demo
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Tips info */}
          <div className="mt-8 p-3 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary leading-relaxed text-center">
            Este é um ambiente de demonstração comercial. Você pode navegar em qualquer empresa e trocar a qualquer momento pelo menu lateral ou cabeçalho.
          </div>
        </div>
      </div>
    </div>
  );
}
