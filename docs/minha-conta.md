# Minha conta no NV Med

A central da equipe interna fica em `/perfil`. O nome **Minha conta** aparece nos menus existentes. As quatro abas podem ser abertas por link, inclusive Segurança em `/perfil#seguranca`. O link antigo `/perfil#verificacao-em-duas-etapas` continua funcionando. O Portal Médico mantém seu fluxo de conta.

## O que está disponível

| Aba | Funções |
| --- | --- |
| Perfil | Nome, telefone brasileiro com DDD, e-mail de acesso somente para leitura, alteração e remoção de foto. O formulário protege alterações em aberto ao sair e permite cancelar. Vínculo, empresa selecionada, cargo e nível de acesso vêm do perfil autorizado. |
| Segurança | Estado do MFA separado do nível AAL da sessão, cadastro e substituição de autenticadores TOTP, senha com validação e confirmação, sessões registradas pelo Auth e revogação das demais sessões. |
| Preferências | Tema claro, escuro ou do sistema, estado do menu lateral, densidade de conteúdo, visualização inicial das escalas, página inicial e avisos de candidaturas e pendências documentais. |
| Atividade | Eventos pessoais em ordem de data, apresentados em páginas de 20. O recorte exibido é de 90 dias desde que haja eventos registrados. |

A página inicial é aplicada no login e no endereço raiz. A escolha é validada no banco e comparada às permissões atuais no login. Os links de escala com uma visualização explícita têm precedência sobre a preferência. O controle de pendências documentais afeta o aviso na central de notificações da equipe, quando o cargo e a política da empresa permitem. A preferência de candidaturas controla a entrega de novos avisos ao Diretor, Gerente e Coordenador de Escalas com permissão efetiva de aprovar. A lista de pendências e os indicadores operacionais permanecem disponíveis conforme as permissões existentes.

## Segurança e dados de origem

- A rota de segurança usa a sessão do próprio usuário com a API do Supabase Auth. A RPC verifica vínculo interno ativo e sessão vigente. Com MFA configurado, exige AAL2 com fator válido e AMR TOTP dos últimos 10 minutos. Sem fator confirmado, exige login recente com senha. O fluxo de senha trata também os desafios de código ou senha atual que o Auth solicitar conforme as opções do ambiente. A redefinição inicial e o fluxo de senha temporária continuam nas rotas existentes.
- A regra mantém o último TOTP válido de qualquer perfil interno ativo depois que ele configura esse método. As operações administrativas que já exigiam MFA continuam com a política da migration 41. O banco serializa exclusões de fator da mesma conta e exige um TOTP verificado como substituto. O endpoint do Auth tem seu próprio requisito de AAL2 para remover fator verificado. A janela de 10 minutos é aplicada pelas rotas da central.
- O QR Code de cadastro é retornado com `no-store` e fica em memória enquanto o diálogo está aberto. Ele contém o material de cadastro necessário ao aplicativo autenticador. A rota entrega o QR e o identificador de cadastro, sem chaves em texto, tokens ou credenciais administrativas. Ao confirmar um TOTP, o Auth pode invalidar sessões com nível de garantia inferior. O comportamento exato depende da versão do Auth.
- As sessões vêm de `auth.sessions`, restritas à identidade autenticada. A central mostra até 20 sessões, incluindo a atual, data de criação e navegador ou sistema quando identificados pelo agente do usuário. Os rótulos são derivados do agente informado pelo cliente. Os identificadores do Auth, o agente integral e os IPs ficam no servidor. A data de renovação de token não mede atividade humana e não aparece como última atividade.
- O encerramento das demais sessões usa o escopo nativo `others`. O Auth revoga os refresh tokens. JWTs emitidos antes disso podem valer até `exp` nos módulos que só validam o token. As RPCs de Minha conta e os controles administrativos existentes exigem a sessão viva.
- O histórico copia apenas eventos selecionados de `auth.audit_log_entries` após a instalação da migration. Eventos de perfil, foto e TOTP são registrados pela transação que grava a mudança. Login, confirmação MFA, alteração de senha feita pelo usuário, solicitação de recuperação e logout dependem da gravação de auditoria do Auth no PostgreSQL. O aviso de recuperação indica a solicitação registrada pelo Auth. Eventos antigos, segredos, IPs e dados da auditoria operacional da empresa ficam fora do histórico pessoal.
- A foto passa pela validação de conteúdo e normalização de imagem que já existiam. O bucket continua privado e a aplicação usa URL assinada. A atualização compara a revisão do perfil e o upload concluído é descartado se a escrita perder uma atualização concorrente.

## Homologação e limites

Aplique `47_staff_account.sql` após a 46 em um ambiente autorizado. A role responsável pela migration precisa conseguir criar os gatilhos de Auth descritos no SQL. Confirme TOTP e **Write audit logs to the database** na configuração do Supabase Auth. Valide a política de troca de senha, as mensagens de novo método/removido, o TTL do JWT e os eventos observados na versão do ambiente antes da publicação.

O laboratório descartável executa a migration, verifica acesso exclusivo do titular, recência, proteção do último fator, ordenação e sessões. A validação do Auth hospedado deve passar por duas sessões e dois autenticadores sintéticos no ambiente de homologação, incluindo troca de senha, autenticação com reserva, efeitos da revogação e entrega de avisos do Auth.

A central usa um autenticador em outro dispositivo como alternativa de recuperação. Se perder todos os fatores, o usuário é orientado a contatar a organização. Um processo administrativo de recuperação precisa de verificação de identidade, aprovação e auditoria, inclusive para contas que administram a plataforma. A etapa deve ser definida e ensaiada antes de oferecer a recuperação. Códigos nativos exigem suporte do Auth e o recurso experimental no SDK. Encerramento individual fica de fora enquanto a aplicação usa apenas os escopos de logout suportados pelo SDK. [Sessões](https://supabase.com/docs/guides/auth/sessions) · [Logout](https://supabase.com/docs/guides/auth/signout) · [Códigos de recuperação](https://supabase.com/docs/reference/javascript/auth-mfa-recovery-codes-verify)

O formato de horário continua sendo o usado pelas escalas e relatórios. Categorias adicionais dependem de fontes de avisos destinadas à equipe interna e ligadas às permissões correspondentes. Avisos de segurança gerenciados pelo Auth dependem da configuração de envio do ambiente e não têm controle de desligamento na central. [Auditoria do Auth](https://supabase.com/docs/guides/auth/audit-logs) · [Segurança de senha](https://supabase.com/docs/guides/auth/password-security)

## Custo e arquivos

A migration usa o PostgreSQL e o Storage existentes. Há uma linha de preferências por pessoa que salva uma escolha e uma linha compacta por evento pessoal selecionado. O índice limita a leitura paginada por titular e data. O recorte de 90 dias é de consulta. Meça a retenção física da tabela em homologação e estabeleça o expurgo periódico conforme a política de auditoria. O projeto não exige serviços pagos, VMs, workers ou dependências extras.

| Área | Arquivos |
| --- | --- |
| Interface | `src/app/(dashboard)/perfil/page.tsx`, `src/components/account/`, `src/components/ProfileMfa.tsx` |
| Integrações | `src/components/{Header,Sidebar,MobileStaffNavigation,DashboardChrome,StoreHydrator}.tsx`, `src/components/DashboardNavigation.module.css`, `src/store/useStore.ts`, `src/app/{page,login/page,(dashboard)/escala/page}.tsx` |
| Perfil e segurança | `src/app/api/{profile,account/security}/route.ts`, `src/lib/{account,accountSecurityClient}.ts`, `src/lib/auth/logout.ts`, `src/lib/supabase/authorizedUser.ts`, `src/services/supabaseService.ts` |
| Dados e validação | `supabase/47_staff_account.sql`, `supabase/staff-account.verify.sql`, `supabase/lab.fixture.sql`, `scripts/test-database.ps1`, `scripts/staff-account.test.mjs`, `scripts/scheduleCalendar.test.mjs`, `scripts/administrative-mfa.test.mjs` |
| Documentação | `docs/minha-conta.md`, `supabase/README.md` |
| Componentes reutilizados | `UserAvatar`, `Dialog`, `notify` e classes e tokens `nv-*` |
