'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { Activity, ShieldCheck, Building, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { organizations, setActiveOrganizationId } = useStore();
  const [selectedOrgId, setSelectedOrgId] = useState('org-1');
  const [username, setUsername] = useState('admin@vnmed.com');
  const [password, setPassword] = useState('••••••••');
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-200">
      {/* Left side: Premium branding poster (full-bleed on mobile if needed, but side-by-side on desktop) */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-tr from-slate-900 via-slate-950 to-teal-950 flex-col justify-between p-12 overflow-hidden border-r border-slate-800">
        {/* Subtle mesh background grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-30" />
        
        {/* Logo and Brand */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="bg-teal-500 text-white p-2 rounded-xl">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <span className="text-xl font-bold text-white tracking-tight">VN Med</span>
            <span className="block text-[10px] text-teal-400 font-bold uppercase tracking-wider">Medical SaaS Platform</span>
          </div>
        </div>

        {/* Big Idea Quote/Heading */}
        <div className="relative z-10 my-auto max-w-md">
          <h2 className="text-4xl font-extrabold text-white leading-tight tracking-tight mb-4">
            Gestão médica inteligente e multiempresas.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            Monitore escalas, centralize a documentação de conformidade do CRM, gerencie unidades de pronto atendimento e otimize plantões em tempo real.
          </p>
        </div>

        {/* Footer info */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-500">
          <span>VN Med Operações Ltda © 2026</span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-4 w-4 text-teal-500" />
            Conexão Criptografada SSL
          </span>
        </div>
      </div>

      {/* Right side: Login form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 lg:px-20 py-12 relative">
        <div className="max-w-md w-full mx-auto">
          {/* Logo mobile */}
          <div className="flex items-center gap-3 lg:hidden mb-8">
            <div className="bg-teal-500 text-white p-2 rounded-xl">
              <Activity className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">VN Med</span>
          </div>

          <div className="mb-8">
            <h3 className="text-2xl font-bold text-white tracking-tight">Acesse sua conta</h3>
            <p className="text-slate-400 text-sm mt-1">
              Selecione a empresa padrão da simulação para prosseguir para o dashboard.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Simulation Company Picker */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
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
                      className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition duration-150 ${
                        isSelected
                          ? 'border-teal-500 bg-teal-950/20 text-white'
                          : 'border-slate-800 bg-slate-900/50 hover:bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Building className={`h-5 w-5 ${isSelected ? 'text-teal-400' : 'text-slate-500'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{org.name}</p>
                          <p className="text-[10px] text-slate-500 truncate">{org.address ? (org.address.split(',')[2] || org.address) : ''}</p>
                        </div>
                      </div>
                      {isSelected && (
                        <span className="h-2 w-2 rounded-full bg-teal-400 ring-4 ring-teal-900" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Email (Simulated input) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Usuário / E-mail
              </label>
              <input
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-teal-500 transition"
              />
            </div>

            {/* Password (Simulated input) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-teal-500 transition"
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-teal-500 hover:bg-teal-600 text-white rounded-xl py-3.5 px-4 font-semibold text-sm flex items-center justify-center gap-2 transition duration-200 disabled:opacity-55"
            >
              {isLoading ? (
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Entrar no VN Med Demo
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Tips info */}
          <div className="mt-8 p-3 rounded-lg bg-teal-950/15 border border-teal-900/30 text-xs text-teal-400 leading-relaxed text-center">
            Este é um ambiente de demonstração comercial. Você pode navegar em qualquer empresa e trocar a qualquer momento pelo menu lateral.
          </div>
        </div>
      </div>
    </div>
  );
}
