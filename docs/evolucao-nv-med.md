# Evolução do NV Med

## Auditoria inicial

A base usa Next.js 16.2.9 com App Router, React 19.2.4, TypeScript 5.9.3, Tailwind 4.3.1, Zustand 5.0.14, Supabase JS 2.116.0 e Supabase SSR 0.12.7. O SDK acessa PostgreSQL, Supabase Auth e Storage. O repositório contém SQL incremental, sem ORM. O Zustand mantém as coleções administrativas em memória e persiste somente preferências de interface. A configuração existente prevê Vercel e Supabase.

As tabelas de origem são empresas, usuários administrativos, médicos, unidades, setores, plantões e documentos. O setor já representa o posto e possui períodos de cobertura. O calendário, o modal, os formulários administrativos, a auditoria documental e o exportador CSV puderam ser reaproveitados. O financeiro já mantinha o valor combinado e os estados pendente e pago.

A leitura via RLS já separava empresas para usuários administrativos. Dentro da empresa, as políticas antigas permitiam leitura ampla de documentos e valores. Não havia vínculo seguro entre o Supabase Auth e o médico. A verificação de conflitos dentro da empresa já existia em JavaScript e em um trigger SQL com trava consultiva. Parte das regras documentais e de elegibilidade dependia do frontend. Exclusões físicas podiam alcançar registros relacionados. Os testes da base tinham 53 cenários e passaram antes da implementação, assim como o lint e o TypeScript.

A árvore de trabalho já tinha alterações em documentação, escalas, navegação e identidade visual, além da migration 18 em desenvolvimento. Essas alterações foram preservadas e serviram de base para as fases seguintes.

## Entregas por fase

| Fase | Implementação e arquivos principais | SQL | Validação e próximo passo |
| --- | --- | --- | --- |
| 1 · Auditoria | Inventário da arquitetura, do modelo de dados, das políticas RLS, do Storage e dos fluxos existentes. | Nenhum | 53 testes de base, lint e TypeScript. A análise apontou a necessidade de separar o acesso médico antes da abertura do portal. |
| 2 · Modelagem e permissões | Login e retorno do Auth em `src/app/login`, `src/app/auth/confirm` e no layout administrativo. Funções SQL concedem acesso por papel, empresa e recurso. | 19 e 24 | Testes SQL de perfis, especialidades, tenant, pasta e acesso direto a valores. A etapa seguinte integrou as permissões ao cadastro e à pasta médica. |
| 3 · Portal e documentação | `src/app/portal`, `medicos/credenciamento`, `api/portal/documents`, `medicalFile.ts`, catálogo em `configuracoes/documentos` e pasta em `documentos/[doctorId]`. Upload compartilhado pelo portal e pela administração via serviço e store existentes. | 19 e 25 | CPF, vínculo legado, pendência, decisões, upload de dados sintéticos, validação de conteúdo, acesso à pasta e autoria auditada. Homologar confirmação de e-mail, SMTP e Storage reais. |
| 4 · Escalas e candidaturas | `escala/page.tsx`, `escala/candidaturas`, `ScheduleCalendarView.tsx`, `ShiftSelectionPanel.tsx`, `unidades/[id]` e `supabaseService.ts`. | 20 e 24 | Múltiplos candidatos, duplicidade, cancelamento, horários sobrepostos, proteção de postos inativos, permissão do coordenador e histórico. Duas conexões reais disputaram a aprovação da mesma oportunidade em PostgreSQL local. |
| 5 · Presença | `PresencePanel.tsx`, `UnitAttendanceSettings.tsx`, `unidades/[id]` e `escala/presenca`. | 21 | Check-in válido, precisão insuficiente, fora do perímetro, duplicidade, check-out sem check-in e exceção autorizada. Homologar os retornos de GPS e a experiência de recusa em aparelho real. |
| 6 · Financeiro | `financeiro/page.tsx`, `financeiro/configuracao`, `financeState.ts`, `types/index.ts`, serviço e store. | 22 e 24 | Vencimento à vista e mensal, virada do ano, preservação do vencimento após alteração de regra, baixa por valor diferente do combinado e acesso financeiro restrito. |
| 7 · Dashboard, relatórios e avisos | `OperationalIndicators.tsx`, `NotificationInbox.tsx`, `relatorios/plantoes`, `api/reports/shifts`, `shiftReport*.ts`, `csv.ts` e dependência `write-excel-file`. | 23 e 25 | Testes de filtros, isolamento, permissões financeiras, CSV, estrutura XLSX e preferências de avisos. Testar os volumes da base real em homologação. |
| 8 · Validação | `supabase/portal.verify.sql`, `medicalFile.test.mjs`, `shiftReport.test.mjs`, `shiftAttendance.test.mjs` e atualização de `documentCompliance.test.mjs`. | Nenhum | 61 testes JavaScript, SQL integrado com dados sintéticos, teste concorrente, lint, tipos e build. Portal público verificado em 320, 390 e 1280 px. Próxima etapa é a homologação autorizada. |

## Decisões de domínio

- O médico entra com uma identidade do Supabase Auth e pode ter credenciamentos independentes em empresas diferentes. O cadastro usa e-mail confirmado e CPF com dígitos verificadores. O vínculo com um registro anterior só é proposto quando e-mail, CPF, CRM e UF coincidem. A coordenação decide e escolhe unidades e especialidades. Pastas legadas ficam disponíveis ao médico após essa decisão.
- O portal consulta uma projeção mensal com vínculo de empresa, unidade, especialidade e situação. Na agenda pessoal, o plantão aparece enquanto aquele médico é o responsável. A vaga usa especialidade explícita para candidatura.
- Vagas e trocas usam a mesma fila de candidaturas. A publicação de troca mantém o médico original. A aprovação bloqueia o plantão, revalida disponibilidade e credenciamento, resolve as candidaturas e registra o histórico na mesma transação. A trava por identidade também cobre plantões de um médico vinculado a mais de uma empresa.
- Postos desativados preservam o histórico. Plantões com candidaturas ou presença passam a ter referências que impedem exclusão física pela interface antiga. Use cancelamento quando precisar retirar da escala um plantão com registros relacionados.
- A presença é pontual e usa o horário do servidor. As unidades definem coordenadas, raio, precisão, tolerância e política de exceção. Check-out confirmado conclui o plantão. As coordenadas ficam em tabela de acesso restrito e ficam fora de relatórios e dos logs gerais.
- O valor combinado e o valor pago têm campos distintos. O vencimento mensal usa a data de início do plantão em São Paulo. À vista usa a data de término. Feriados são cadastrados pela empresa. As regras atualizadas valem para novos cálculos. Plantões legados podem ter vencimento ausente até serem revisados ou salvos novamente.
- Empresas novas recebem checklist inicial. Empresas existentes podem acrescentar itens faltantes com confirmação. Certidões são configuráveis por UF do CRM e renovação anual, com a data de validade do ano da revisão. Documentos bloqueiam escala quando a empresa habilita essa política e marca a exigência como impeditiva.
- O arquivo é validado no servidor por extensão, MIME declarado, assinatura, terminador e tamanho, até 4 MB. O bucket é privado. O portal usa um link assinado de 60 segundos e serve o documento como download. A administração mantém acesso temporário às versões anteriores para auditoria.
- Avisos são internos e idempotentes. Preferências individuais controlam novas oportunidades, documentos e lembretes. Lembretes e alertas de vencimento são gerados na consulta da caixa de avisos. Decisões críticas são registradas no momento em que ocorrem.
- O relatório aceita até 366 dias e 10.000 plantões por exportação. A prévia mostra os primeiros 100. O CSV usa BOM UTF-8 e protege texto que possa ser interpretado como fórmula. O XLSX inclui cabeçalho fixo, filtros, datas, moeda, destaques e totais financeiros em aba separada quando o acesso permite.

## Homologação e aplicação

1. Identifique as migrations já aplicadas no ambiente de destino. Confirme a migration 18 e as políticas de RLS e Storage vigentes. Inventarie duplicidades de médicos, registros legados sem especialidade e vínculos inválidos. Revise volumes de plantões e documentos antes da janela.
2. Após autorização do ambiente, providencie backup do banco e verifique a restauração. Execute `19_doctor_portal.sql` a `25_document_notification_rules.sql` em ordem numérica. Cada arquivo tem sua própria transação.
3. Planeje a troca da aplicação na mesma janela das migrations 24 e 25. A versão anterior usa acesso direto a campos financeiros da tabela de plantões e envia arquivos diretamente ao bucket. A versão nova usa a projeção autorizada e o endpoint de upload.
4. Em homologação, confirme cadastro com e-mail real de teste, redirecionamento de confirmação, expiração do link assinado e download. Configure os redirects do Auth para a rota `/auth/confirm` do domínio autorizado e valide o cadastro com parâmetro de empresa. Mantenha a confirmação de e-mail, a política de senha e os limites do Auth habilitados. [Redirecionamentos do Supabase Auth](https://supabase.com/docs/guides/auth/redirect-urls)
5. Teste dois tenants com perfis médico, coordenador, escalista e financeiro. Valide a seleção de candidatos e a edição de plantões pelo caminho normal da interface. Teste a presença em dispositivo móvel por HTTPS, dentro e fora do raio, com GPS desativado e permissão recusada. [Geolocalização no navegador](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
6. Confira o planejamento mensal da empresa, incluindo feriados, valores históricos e postos sem especialidade explícita. Abra uma exportação XLSX em Excel e compare os totais com a consulta de origem.

## Limites e operação de dados sensíveis

- Os testes SQL usaram PostgreSQL 16 descartável, com interfaces sintéticas de Auth e Storage. A homologação precisa validar o serviço real e a autorização ponta a ponta com dados de teste.
- A geolocalização do navegador informa posição e precisão. A verificação por perímetro usa esses dados como evidência operacional, sujeita à integridade do dispositivo.
- A validação de formato e a entrega privada reduzem exposição. A varredura antimalware e a quarentena ainda dependem de integração de infraestrutura autorizada.
- A retenção operacional deve ser definida por empresa e tipo de registro antes da publicação. Preserve versões e trilhas de auditoria durante o prazo definido. Restrinja inventários e exportações a pessoas autorizadas. Antes de qualquer eliminação ou anonimização, verifique obrigações de preservação e referências ao arquivo, registre a decisão e confirme o escopo com o responsável pela empresa. A execução automática de expurgo permanece pendente.
- A tela administrativa legada de médicos mantém a leitura cadastral no escopo da empresa. Reduzir campos retornados por função administrativa continua sendo um ajuste de minimização a validar separadamente.
- Esta revisão ficou restrita ao ambiente local descartável. A homologação em banco persistente e a publicação dependem de autorização.
