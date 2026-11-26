# Status cadastral e confirmações do NV Med

## Diagnóstico

O fluxo anterior abria `window.confirm` e chamava a RPC de edição completa do perfil para alterar apenas `status`. Essa RPC atualizava também outros campos e sincronizava o checklist documental; o frontend dependia de outra leitura para atualizar a listagem. O erro era encaminhado como mensagem bruta, sem tratamento próprio para as restrições de ativação.

A regra `nv_require_new_doctor_banking`, da migration 32, é uma constraint diferida: a ativação só pode concluir se a chave PIX e seu tipo estiverem preenchidos. Quando essa validação falha no commit, o PostgreSQL reverte o status e a auditoria daquela tentativa. Não é um erro de enum nem uma autorização para ignorar a validação.

Uma consulta agregada somente leitura no ambiente existente encontrou 36 médicos pendentes, 32 deles sem o cadastro bancário completo exigido para ativação. Também confirmou que a auditoria anterior registrava o campo afetado, mas não o status anterior e o novo status. Nenhum dado médico foi consultado individualmente ou alterado nessa investigação. A mesma rejeição foi reproduzida no PostgreSQL descartável, verificando a mensagem e o rollback.

## Correção

- A migration `53_doctor_status.sql` cria `nv_set_doctor_status`, com validação de cargo, tenant, status e revisão concorrente. A gravação atualiza somente o status cadastral e mantém as constraints existentes, inclusive a bancária. A resposta contém somente campos profissionais permitidos.
- `setDoctorStatusInSupabase` aguarda a resposta transacional e valida a confirmação do backend. Leituras e gravações têm timeout. `useStore.setDoctorStatus` atualiza a coleção compartilhada somente após sucesso, refletindo perfil, listagem e filtros. Não depende de recarregar toda a aplicação.
- Erros de permissão, PIX incompleto, revisão concorrente e migration indisponível têm mensagens conhecidas. Erros inesperados ou de conexão usam uma mensagem genérica. O console recebe apenas operação, código, status HTTP e tipo do erro, sem mensagem SQL, dados médicos ou credenciais.
- A auditoria passa a guardar `previous_status` e `status`, além de ator e horário. O histórico traduz os valores para Ativo, Pendente e Inativo. Repetir o status atual não gera alteração nem auditoria duplicada.
- Cadastro, credenciamento, documentos, escalas, finanças e Auth permanecem independentes. A operação não chama criação de usuário, envio de e-mail, convite ou liberação do portal.

## Padrão compartilhado

`ConfirmationDialog` reutiliza `Dialog`; `ConfirmationProvider/useConfirmation` oferece o mesmo modal para ações nas páginas. `DeleteConfirmDialog` preserva a validação digitada dentro desse padrão. Confirmações com formulários existentes usam a variante compartilhada de `Dialog`. Os toasts continuam usando Sonner por `notify` e `Notifications`, com os mesmos tokens semânticos.

O padrão foi incorporado em `UI_UX_GUIDELINES.md`: modal compacto, ícone contextual em círculo suave, texto direto, cancelamento secundário, confirmação verde ou destrutiva vermelha, carregamento e foco. Os toasts têm ícone, título, descrição quando necessária e fechamento. Temas e redução de movimento usam as variáveis e preferências existentes.

Foram substituídas as caixas nativas em status e exclusão de médicos, exclusão de unidades, checklist documental, decisões de presença, candidaturas/trocas, orientação de acesso de usuários, especialidade duplicada e descarte no logout. O `beforeunload` foi mantido exclusivamente para proteger dados não salvos ao fechar/recarregar a aba, pois o navegador não permite um modal assíncrono nessa etapa. A função de aplicação chamada `confirm` em `PortalSchedule` não é uma chamada à caixa nativa.

## Revisão com unslop-ui

Diagnóstico leve. Escopo comparável: `Dialog`, `DeleteConfirmDialog`, `Notifications` e perfil médico, com `--surface`.

| Regra | Antes | Depois | Mantidos de propósito |
| --- | ---: | ---: | ---: |
| U1, rótulos em caixa alta | 4 | 4 | 4 rótulos de identificação de dados existentes |
| U20, transição genérica | 1 | 0 | 0 |

Foram mantidos os ícones contextuais, círculos suaves e cores semânticas solicitados expressamente pelo usuário. As descrições explicam a preservação dos dados e a independência do portal, informações necessárias à decisão. Nenhum selo decorativo ou descrição promocional foi adicionado.

## Publicação

### Validações concluídas

- `npm test`: 163 testes aprovados.
- `npx tsc --noEmit`: aprovado.
- `npm run lint`: aprovado. `eslint.config.mjs` passou a ignorar `.vercel/**`, com milhares de cópias e artefatos de deploy gerados; o código da aplicação e os scripts continuam verificados. A regra `no-alert` impede novas caixas nativas na aplicação.
- `scripts/test-database.ps1`: sequência 01–53 e suítes SQL aprovadas no PostgreSQL local descartável. A suíte de status reproduziu o bloqueio bancário, exercitou as transições, revisão concorrente, negação por tenant/identidade e os metadados da auditoria. Assinaturas dos dados confirmaram a preservação de médicos, documentos, plantões, credenciamento, banco e Auth.
- `node scripts/doctor-status.browser.mjs`: 17 verificações aprovadas. Incluem os quatro caminhos de status, persistência após reload, atualização da listagem e filtro, clique duplicado, cancelamento, Escape e foco, toast dispensável, restrições bancárias, negação, falha de rede, ausência de erro bruto e ausência de caixas nativas. Foram inspecionadas capturas em 1440 px no tema claro e em 390/360 px no tema escuro.
- Build isolado de produção com `next build --webpack`: aprovado, com 42 páginas geradas. O build padrão por Turbopack falhou neste ambiente: seu processo auxiliar de CSS encerrou antes da conexão, apontando `Account.module.css`. Não foi alterado esse módulo nem o compilador padrão para mascarar a falha; a limitação permanece registrada.

O teste de navegador usa o Playwright local do laboratório. Para worktrees com dependências no diretório superior, use NVMED_BROWSER_WEBPACK=1. Em outra máquina, configure `NVMED_PLAYWRIGHT_MODULE` com o módulo instalado e `NVMED_BROWSER_EXECUTABLE` com o navegador. Não há nova dependência ou serviço pago. As capturas e resultados sintéticos estão em `Import/_status-ui-20261125`, fora do pacote de produção.

### Arquivos da correção

| Área | Arquivos principais |
| --- | --- |
| Status e persistência | `src/lib/doctorStatus.ts`, `src/services/supabaseService.ts`, `src/store/useStore.ts`, `src/app/(dashboard)/medicos/[id]/page.tsx` |
| Banco e auditoria | `supabase/53_doctor_status.sql`, `src/components/DoctorProfileHistory.tsx` |
| Componentes compartilhados | `src/components/ConfirmationDialog.tsx`, `ConfirmationProvider.tsx`, `Dialog.tsx`, `DeleteConfirmDialog.tsx`, `src/app/layout.tsx`, `src/app/globals.css` |
| Caixas nativas substituídas | Páginas de médicos, unidades, configurações, documentação, usuários e presença; `ShiftSelectionPanel.tsx` e `account/AccountLeaveGuard.tsx` |
| Confirmações existentes | `DoctorPortalAccess.tsx`, `ScheduleEditGuard.tsx`, `ScheduleDeleteDialog.tsx`, `ScheduleMasterView.tsx`, `ShiftApprovalDialog.tsx`, `ShiftPaymentMovements.tsx`, `BillingActionDialog.tsx` e cancelamento de posto na página de escalas |
| Padrão e verificações | `docs/UI_UX_GUIDELINES.md`, `scripts/doctorStatus.test.mjs`, `scripts/doctor-status.browser.mjs`, `supabase/doctor-status.verify.sql`, `scripts/test-database.ps1`, `eslint.config.mjs` |

A publicação foi autorizada em 25/11/2026 e preparada em uma worktree baseada no commit 18d685b, confirmado no alias de produção. A versão preserva as melhorias de nomes, conta e cobertura fracionada já publicadas. Foram aprovados 168 testes, lint, build Webpack, 17 cenários de navegador e as suítes SQL da estrutura atual (até a migration 54, seguidas de 53_doctor_status.sql). Este arquivo 53 é independente do 53_fractional_coverage.sql já publicado; ambos são preservados. A aplicação é protegida por pré-verificações, backup e comparação transacional dos dados e controles de segurança. A migration não cria acessos e não faz alterações em lote. Um frontend novo sem a migration apresenta mensagem de atualização necessária, em vez de simular sucesso.

Os testes de navegador usam a aplicação real, com fixtures de Auth/Data API restritas a loopback. As regras e a persistência transacional são verificadas separadamente no PostgreSQL real descartável. Não foram utilizados médicos ou contas reais para alterar status.

## Publicação confirmada em 25/11/2026

- Migration aplicada: 53_doctor_status.sql, em transação única com guardas de catálogo, timeout e comparação de hashes antes/depois. O commit da transação preservou integralmente médicos, plantões, documentos, credenciamentos, dados bancários, histórico, Auth, RLS, grants de tabelas e gatilhos.
- Contagens preservadas: 98 médicos, 960 plantões, 1.354 registros documentais, 65 credenciamentos, 65 registros bancários e 13 contas Auth. Zero operações de acesso criadas e zero convites enviados. Nenhum status real foi alterado para testar a publicação.
- Backup privado anterior: Import/_execution/production-before-doctor-status-20261125.dump, catálogo e SHA-256 verificados. O SQL privado de rollback restaura a função de auditoria anterior e remove a nova RPC, sem excluir dados.
- Commit publicado: 5737b916c1723fbd071e75e80ae4c54abbfca0c2, branch local codex/doctor-status-release, baseada em 18d685b. Nenhuma outra alteração pendente do workspace foi publicada ou descartada. A publicação foi direta na Vercel; não foi feito push para o GitHub.
- Deployment READY: dpl_mkXJfKspowKhyZnAD6GZg71UYDvP, promovido para https://med.nvcore.com.br. O build padrão remoto com Turbopack passou; a falha descrita anteriormente ficou restrita ao ambiente local.
- Verificação pública às 19:15 BRT: /login 200, /medicos 307 para /login, /portal 200 (entrada pública existente), /api/health 401 sem autenticação. CSS de confirmações e toasts presente no domínio oficial.
- Pós-verificação SQL: RPC disponível para authenticated, negada para anon/service_role, auditoria com status anterior/novo, constraint bancária e normalização de nomes preservadas. Os testes funcionais (168 de aplicação e 17 de navegador) usaram dados fictícios locais; a aplicação da migration e as verificações de catálogo ocorreram no Supabase real.
- Rollback de frontend: deployment anterior dpl_9f1TAXan5Bjr2uTmkGFHnpCpHec6, fonte 18d685b. A nova RPC é aditiva e compatível com o frontend anterior. Evidências privadas em Import/_status-ui-20261125 e Import/_execution/status53-*.json, excluídas do deploy.

## Validação funcional em produção — 25/11/2026

Foi usada a sessão administrativa existente, exclusivamente para gravar alterações no cadastro já fictício “QA Toast fictício 2411 Mobile 196941”, da empresa NV Med Piloto Sintético A. Não foi criado outro cadastro.

- Transições confirmadas: Pendente → Ativo → Inativo → Ativo → Pendente. A última devolve o cadastro ao estado inicial. O status Inativo persistiu após reload e o Pendente foi confirmado em uma aba nova e no SQL final.
- Os quatro registros de auditoria (51–54) têm somente o campo status, valores anterior/novo, ator e horário. Cancelamento, Escape, status atual e clique duplo não criaram gravações adicionais.
- Desktop claro em 1440 px: modal compacto com ícone semântico circular, título, descrição, cancelamento e confirmação verde/vermelha. Cancelar e Escape preservaram Pendente e devolveram foco ao botão Ativo.
- Mobile escuro em 390/360 px: modais cabem na viewport, sem overflow horizontal. O toast de sucesso em 360 px tem ícone, título, descrição e fechamento, acima da navegação inferior. O carregamento foi encerrado após sucesso.
- Listagem e filtros refletiram o status salvo: o cadastro apareceu no filtro Ativo e ficou ausente no Inativo. O portal permaneceu “Não liberado”, sem último acesso. Nenhuma ação de convite, senha ou liberação foi acionada.
- Comparação final por hashes: demais médicos, outros campos do médico testado, plantões, documentos, credenciamentos e dados bancários preservados. Permanecem 13 contas Auth e zero operações de acesso.
- Empresa original, tema claro e dimensões normais foram restaurados; abas temporárias fechadas. A aba original permaneceu no perfil fictício, pois a ferramenta perdeu a conexão de depuração dessa aba e a navegação de volta falhou.

Limites desta rodada: o toast de erro e o fim do loader após erro não foram revalidados em produção. A inspeção nativa travou antes de simular a falha de conexão, sem alterar a conexão. Os cenários de erro continuam cobertos pelos testes locais anteriores, que não substituem essa observação ao vivo. O carregamento inicial/reload também ultrapassou uma espera de UI de 20 segundos antes de concluir; a causa não foi determinada. Não foram observados erros de console nas páginas funcionais inspecionadas.

Evidências privadas e comparação: Import/_status-ui-20261125/production-live-qa.json e Import/_execution/status53-live-qa-{before,after-transitions,final}.json. As capturas visuais foram exibidas durante a execução. Não houve alteração de código ou nova publicação nesta validação.

## Complemento concluído: toast de erro e aba original — 25/11/2026

O teste pendente foi concluído na aplicação de produção, pela sessão administrativa existente, com o mesmo médico fictício da empresa piloto. Foram realizadas duas tentativas de ativação rejeitadas, sem alteração de status ou outros dados.

Para produzir uma falha real e limitada, uma transação de QA reteve somente a linha do cadastro fictício por no máximo 40 segundos e terminou em ROLLBACK, sem INSERT/UPDATE/DELETE. O timeout já existente de 8 segundos recusou a gravação solicitada pela UI. Não houve alteração de configurações, permissões, RLS ou credenciais, e nenhum serviço externo de teste foi usado.

- Desktop claro 1440×1000 e mobile escuro 360×800: “Salvando…” foi observado durante a gravação; a confirmação ficou desabilitada; após a rejeição o loader desapareceu, o modal permitiu cancelar/tentar novamente e o status continuou Pendente.
- Toast real: ícone de erro, título “Não foi possível concluir a ação.”, descrição “Não foi possível alterar o status do cadastro. Tente novamente.” e fechamento acessível. Nenhuma mensagem SQL foi exibida.
- Mobile claro 390×844 e escuro 360×800: toast legível, dentro da viewport, sem overflow horizontal; dispensar a notificação e cancelar o modal funcionaram.
- Comparação completa dos snapshots antes/depois: iguais, incluindo os quatro registros de auditoria anteriores. Permanecem 13 contas Auth e zero operações de acesso. Nenhum acesso liberado, convite ou redefinição de senha. Zero transações de QA e zero requisições de status bloqueadas ao final.
- A mesma aba original (265500661) foi restaurada para a URL inicial, empresa CAP Serviços Médicos, tema claro e dimensões normais 1406×918, sem modais ou toasts pendentes. O médico real dessa página não foi editado.

Na primeira volta à URL original ocorreu uma falha de leitura de medical_documents; foi acionado apenas “Tentar novamente”, e o contexto final foi conferido após o carregamento. Essa ocorrência de carregamento é distinta do teste de toast e não foi diagnosticada como parte desta validação.

As limitações anteriores referentes ao toast de erro e à restauração da aba estão encerradas. Evidências privadas: Import/_status-ui-20261125/production-live-error-qa.json e Import/_execution/status53-live-error-*.json. As capturas de desktop/mobile foram exibidas durante a execução. Não houve alteração de código nem nova publicação.
