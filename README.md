# NV Med - SaaS Gestão Médica Multiempresas

O **NV Med** é um protótipo de alta fidelidade e comercialmente apresentável de uma plataforma SaaS multiempresas voltada para a gestão de equipes clínicas, escalas de plantão e auditoria documental de conformidade médica.

A plataforma faz parte do ecossistema **NV Hub / Morales Hub**, aplicando o mesmo padrão de design premium e de restrição visual (Linear-style dashboard).

---

## 🌟 Funcionalidades Principais Demonstradas

1. **Multitenancy Estrito (Isolamento por Empresa)**:
   - Alternância de contexto de empresa em tempo real sem cruzamento de dados.
   - Cada empresa visualiza exclusivamente seus próprios médicos, unidades físicas, plantões agendados e regras de compliance.
   - Simulador no painel super-admin em `/empresas`.

2. **Gestão de Grade e Escalas de Plantões (`/escala`)**:
   - Visualização em calendário dinâmico mensal (suporta navegação entre meses).
   - Filtros rápidos por médico, unidade hospitalar, especialidade e status do turno.
   - Agendamento simplificado via modal com amarração automática ao médico/unidade do respectivo tenant.

3. **Central de Compliance Documental (`/documentos` e `/medicos/[id]`)**:
   - Gerenciamento de 6 pastas obrigatórias recomendadas pelo CRM (RG/CNH, Diploma de Medicina, Residência, Endereço, Certidões Éticas e Financeiras do CRM).
   - Upload simulado localmente atualizando o status dos arquivos.
   - Ações imediatas de auditoria (Aprovar / Reprovar / Expirar) de documentos que atualizam o balanço de alertas no Header em tempo real.

4. **Painéis Gerais de Métricas e KPIs (`/dashboard`)**:
   - Totalizadores de corpo clínico ativo, irregularidades cadastrais críticas, unidades vinculadas e plantões do mês.
   - Gráficos de barra consolidando plantões agendados por unidade e composição de corpo clínico por especialidade.

---

## 🛠️ Stack Tecnológica

- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Biblioteca**: [React 19](https://react.dev/)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/)
- **Estilização**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Estado Global**: [Zustand](https://github.com/pmndrs/zustand) (com persistência em `localStorage`)
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

Abra [http://localhost:3000](http://localhost:3050) no navegador para testar a aplicação.

---

## 🔒 Arquitetura de Demonstração
Para fins de validação e apresentações comerciais simplificadas, o sistema **não** se conecta a banco de dados real. Todas as operações de criação, exclusão de escala ou upload de documentos são mantidas no estado global em memória do Zustand e persistidas no `localStorage` do navegador do cliente. Você pode restaurar os dados originais da demo a qualquer momento na página de **Configurações**.
