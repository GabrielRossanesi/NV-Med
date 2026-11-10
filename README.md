# NV Med - SaaS Gestão Médica Multiempresas

O **NV Med** é uma aplicação SaaS multiempresas para credenciamento médico, escalas de plantão, presença, pagamentos e auditoria documental.

A plataforma faz parte do ecossistema **NV Hub / Morales Hub**, aplicando o mesmo padrão de design premium e de restrição visual (Linear-style dashboard).

---

## Funcionalidades

1. **Multitenancy Estrito (Isolamento por Empresa)**:
   - Alternância de contexto de empresa em tempo real sem cruzamento de dados.
   - Cada empresa visualiza exclusivamente seus próprios médicos, unidades físicas, plantões agendados e regras de compliance.
   - Simulador no painel super-admin em `/empresas`.

2. **Gestão de Grade e Escalas de Plantões (`/escala`)**:
   - Visualização em calendário dinâmico mensal (suporta navegação entre meses).
   - Filtros rápidos por médico, unidade hospitalar, especialidade e status do turno.
   - Agendamento simplificado via modal com amarração automática ao médico/unidade do respectivo tenant.
   - Plantões avulsos por especialidade, com motivo e datas de cobertura limitadas, vagas abertas e filtro próprio. A cópia de semanas e turnos considera somente postos regulares.

3. **Central de Compliance Documental (`/documentos` e `/medicos/[id]`)**:
   - Catálogo de documentos definido pela empresa em `/configuracoes/documentos`, acessível pelo Perfil da empresa. Cada exigência pode abranger todas as unidades ou unidades específicas, com filtros por especialidade.
   - Upload de arquivos médicos com acompanhamento de validade e histórico de análise.
   - Ações imediatas de auditoria (Aprovar / Reprovar / Expirar) de documentos que atualizam o balanço de alertas no Header em tempo real.

4. **Painéis Gerais de Métricas e KPIs (`/dashboard`)**:
   - Totalizadores de corpo clínico ativo, irregularidades cadastrais críticas, unidades vinculadas e plantões do mês.
   - Gráficos de barra consolidando plantões agendados por unidade e composição de corpo clínico por especialidade.

5. **Portal médico e operação de plantões**. O médico usa `/portal` para se credenciar, acompanhar documentos e candidaturas e gerenciar a agenda. A coordenação decide cadastros e candidaturas nas filas do painel. Presença por geolocalização depende da configuração da unidade.

6. **Financeiro e relatórios**. O financeiro calcula vencimentos e registra a baixa manual. Em `/relatorios/plantoes`, os filtros do servidor também se aplicam aos arquivos CSV e XLSX.

---

## 🛠️ Stack Tecnológica

- **Framework**: [Next.js 16.2.9](https://nextjs.org/) (App Router)
- **Biblioteca**: [React 19](https://react.dev/)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/)
- **Estilização**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Estado Global**: [Zustand](https://github.com/pmndrs/zustand), com preferências de interface em `localStorage`
- **Persistência**: [Supabase](https://supabase.com/), com PostgreSQL, Auth e Storage privado
- **Ícones**: [Lucide React](https://lucide.dev/)

---

## 🚀 Como Iniciar Localmente

Instale as dependências:
```bash
npm install
```

Inicie o servidor de desenvolvimento:
```bash
npm run dev
```

Abra [a aplicação local](http://localhost:3000) no navegador. Copie `.env.example` para `.env.development.local` para trabalhar com o Supabase desativado ou configurar um alvo isolado. [Configuração de homologação](docs/homologacao-nv-med.md)

---

## Banco e validação

O guia do banco descreve a ordem de instalação. O plano de implantação reúne a preparação do piloto interno, o domínio oficial e a recuperação. [Guia do Supabase](supabase/README.md) · [Implantação controlada](docs/implantacao-controlada-nv-med.md)

```bash
npm test
npm run lint
npm run build:local
```
