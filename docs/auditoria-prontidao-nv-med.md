# Auditoria de prontidão do NV Med

**Data:** 9 de novembro de 2026, horário de São Paulo  
**Parecer:** **não liberar a homologação em nuvem nesta configuração**

O único destino do NV Med encontrado é o Supabase de produção. O deploy ativo ainda usa o contrato antigo de leitura de plantões e upload de documentos. A homologação exige um projeto isolado, uma linha de base confirmada, recuperação ensaiada e as correções de acesso descritas abaixo.

A auditoria usou catálogos, configurações visíveis, requisições públicas de leitura e revisão estática. Nenhum registro clínico ou arquivo médico foi aberto. A suíte automatizada executada nesta revisão foi a JavaScript local. Migrations, deploy, backup, restauração e testes de escrita ficaram fora da execução.

## Ambientes e versão observados

| Superfície | Evidência | Resultado |
| --- | --- | --- |
| Supabase de produção | No painel, o projeto NV Med, região São Paulo, apresenta apenas a branch `main`, marcada `PRODUCTION`. As organizações acessíveis foram verificadas e nenhum segundo projeto de homologação do NV Med foi identificado. | Produção confirmada. Homologação separada não encontrada no escopo acessível. |
| Vercel Production | Deploy ativo pronto, associado ao commit `71c4873`. O login público retornou HTTP 200 e seu bundle aponta para o mesmo Supabase do painel. A rota `/portal` retornou HTTP 404. | Aplicação ativa anterior ao portal e às migrations 19 a 25. A associação ao commit é metadado do deploy CLI e não prova que todo o artefato é idêntico à árvore Git. |
| Vercel Preview e Development | As variáveis Supabase do projeto estão com escopo Production. A aba de variáveis compartilhadas não tem vínculos. | Nenhum destino Supabase independente configurado nesses escopos. |
| Configuração local | `.env.local` aponta para o mesmo Supabase da produção e contém chave pública. A chave de serviço não está presente no arquivo. `.env.example` contém apenas um modelo. | Rodar o projeto com a configuração local padrão pode atingir produção. O novo upload exige chave de serviço no servidor do ambiente de teste. |
| PostgreSQL descartável | A validação anterior usou PostgreSQL 16 com interfaces sintéticas de Auth e Storage. | Laboratório, sem equivalência com um Supabase de homologação. |

A comparação entre painel, configuração local e bundle foi feita sem emitir valores de variáveis. A API administrativa da Vercel retornou 403 com a sessão CLI existente. O painel solicitou verificação adicional para revelar a URL pública configurada. O desafio foi encerrado e a comparação do destino ativo foi concluída pelo bundle público. [Escopos de ambiente da Vercel](https://vercel.com/docs/environment-variables)

## Estado das migrations

O painel de histórico de migrations retornou `28P01`, erro de autenticação da conexão administrativa. O catálogo de tabelas e funções abriu normalmente. O catálogo comprova o estado visível do esquema, mas a autoria, a ordem e o checksum de cada execução dependem do histórico ou de uma comparação com as definições do banco.

| Migrations | Evidência no Supabase de produção | Classificação |
| --- | --- | --- |
| 01 e 06 | Tabelas principais e `sectors`, colunas `sector_id` e `specialty` em `shifts`, funções de validação de posto e plantão. | Marcadores presentes. |
| 05, 08 e 09 | Funções administrativas e de tenant, buckets `medical-documents` e `profile-avatars`, políticas `nv_files_*` e `nv_avatar_read`, função `nv_delete_organization`. | Marcadores presentes. |
| 10, 11, 12 e 13 | Campos financeiros legados, funções de baixa, validador de permissões adicionais e tabela `document_audit_logs` com funções de auditoria e versão. | Marcadores presentes. |
| 14, 16, 17 e 18 | `rqe`, `contract_model` e `contract_signed` em médicos, `coverage_periods` em postos, funções do catálogo documental, `coverage_mode` e `coverage_reason` e funções específicas da 18. | Marcadores presentes. |
| 02, 03, 04, 07 e 15 | As 02 e 04 têm políticas substituídas nas etapas posteriores. As 03 e 07 são cargas ou bootstrap. A função tocada pela 15 existe, mas sua definição exata e os vínculos dos triggers não foram confirmados. | Execução individual indeterminada. |
| 19 a 25 | O catálogo exibe as oito tabelas legadas. Faltam tabelas, funções e colunas novas, entre elas as de credenciamento, candidaturas, presença, vencimentos, relatórios e salvamento da escala. As políticas diretas de inserção e exclusão do bucket médico continuam presentes. | Evidência de que a sequência 19–25 não está instalada no esquema inspecionado. |
| Homologação | Nenhum projeto ou branch separado identificado. | Histórico inaplicável até identificar ou provisionar o destino. |

A lista de scripts do repositório é uma referência de implantação. Os arquivos são SQL numerados e parte do fluxo anterior usa o SQL Editor. A ausência de histórico legível não equivale a banco vazio. O README lista a ordem proposta. [Guia do banco](../supabase/README.md) · [Histórico e deploy de migrations do Supabase](https://supabase.com/docs/guides/deployment/database-migrations)

## Impacto por migration

| Etapa | Mudança de acesso ou dados | Impacto operacional |
| --- | --- | --- |
| 19 | Cria credenciamento, decisões e avisos, restringe leitura de documentos, logs e objetos a novos predicados e oferece RPCs de acesso por vínculo. | Perfis que hoje leem arquivos por pertencer à empresa podem perder acesso intencionalmente. O vínculo legado só abre a pasta após aprovação. Os nomes de política que a migration remove precisam existir no alvo. |
| 20 | Cria oportunidades, candidaturas e histórico. Adiciona validações a plantões e usa bloqueios por plantão e identidade. | Unidade ou posto inativo, especialidade ausente, documento impeditivo ou horário inválido podem passar a impedir atribuições. Referências preservam o histórico e podem bloquear as exclusões legadas. |
| 21 | Registra presença e exceções em tabelas fechadas e fornece RPCs para médico e coordenação. | Check-out aceito conclui o plantão. Referências protegem o plantão e a unidade, e alterações operacionais após presença registrada podem ser recusadas. |
| 22 | Adiciona vencimento, valor efetivamente pago, observação, regras por empresa e auditoria financeira. | Registros antigos podem continuar com vencimento ou valor pago ausente. Alterações em plantões pagos e estados legados inconsistentes podem ser recusadas em uma atualização posterior. |
| 23 | Expõe relatório e indicadores autorizados, com projeções separadas de presença e financeiro. | Validar filtros, contagens, limites e tempo de resposta com volume representativo. Coordenadas e dados financeiros ficam fora das projeções que não os autorizam. |
| 24 | Revoga leitura ampla e escrita direta em `shifts` e cria a visão mascarada `nv_staff_shifts` e RPC de escrita. | O código de `71c4873` usa `select('*')` e `upsert` em `shifts`. A 24 isolada pode derrubar o carregamento do painel e impedir a edição. A versão nova também depende da 24 para carregar a visão. |
| 25 | Restringe escrita de metadados, remove inserção e exclusão diretas do bucket médico, exige envio pelo servidor e altera regras e auditoria de revisão. | A versão antiga deixa de subir arquivos. A versão nova exige chave de serviço válida no servidor. O limite do endpoint é 4.000.000 bytes, abaixo dos 10 MB exibidos pelo bucket atual. |

**Janela de troca.** Planejar o banco e a aplicação como uma única entrega operacional. Em homologação, levantar a versão compatível somente após checar o esquema. Em produção futura, congelar operações na janela e considerar abas antigas e clientes externos. Cada arquivo possui sua própria transação, o que permite falha parcial entre arquivos já confirmados. Confirmar o resultado de cada arquivo antes de decidir continuar. [Migração 24](../supabase/24_financial_data_access.sql) · [Migração 25](../supabase/25_document_notification_rules.sql) · [Privilégios de coluna no Supabase](https://supabase.com/docs/guides/database/postgres/column-level-security)

## Riscos e critérios de bloqueio

### Antes da homologação em nuvem

1. **Crítico · Destino e recuperação.** Confirmar um Supabase separado, com Auth, Storage e chaves próprios. Usar Preview protegido e contas de teste. Verificar que a URL incorporada no build de Preview diverge da produção. A linha de base e as políticas devem ser confirmadas no alvo. A falha `28P01` impede certificar o histórico de produção e executar um diagnóstico agregado por essa via. Qualquer eventual reparo de credencial requer uma ação separada e autorizada.
2. **Alto · Senha temporária e autorização direta.** O layout e alguns endpoints usam `must_change_password`. Os predicados SQL antigos e novos autorizam por `auth.uid()`, perfil e papel sem essa condição. Endpoints administrativos também verificam papel sem consultar a exigência de troca. Uma sessão com senha temporária pode, pelo código, contornar a tela e alcançar Data API, RPCs ou rotas administrativas. Aplicar a restrição no backend e no banco, preservando o fluxo de redefinição. Testar com tokens antigos, conta desativada e troca concluída. [RLS e perfis](../supabase/05_production.sql) · [Predicados do portal](../supabase/19_doctor_portal.sql) · [Rota de usuários](../src/app/api/admin/users/route.ts)
3. **Alto · Assinatura de documento com privilégio de serviço.** O download autoriza a linha e usa `file_path` com chave de serviço. A rota não valida novamente a correspondência do objeto com empresa e médico. O trigger legado valida novos caminhos em escritas, mas registros antigos, importados ou inconsistentes exigem pré-verificação. Exigir caminho canônico, bucket certo e existência do objeto antes de assinar. Definir e testar a revogação após desativação do médico ou suspensão da empresa, pois `nv_owns_doctor` se apoia principalmente no estado do credenciamento. O risco de caminho legado não foi reproduzido em produção. [Rota documental](../src/app/api/portal/documents/[id]/route.ts) · [Validador de vínculos](../supabase/15_fix_unit_link_trigger.sql) · [Regra de autorização documental](../supabase/25_document_notification_rules.sql)
4. **Alto · Grants financeiros e fronteira do bucket.** Conferir RLS, privilégios por coluna, membros de papéis, permissões de execução e todas as políticas sobre `storage.objects`. Revogar um privilégio de tabela pode deixar grants específicos de coluna. Outras políticas permissivas podem abrir caminhos além dos nomes removidos pelos scripts. A aprovação exige teste negativo pela Data API, RPC, Storage e exportação com dois tenants e perfis de leitura, edição e operação. Em produção, a política do bucket médico ainda usa `nv_org_access`, que é mais ampla que a permissão documental da 19. A inspeção foi da regra e do código, sem acessar arquivos. [Migração 24](../supabase/24_financial_data_access.sql) · [RLS no Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
5. **Alto · Contrato de versão e dados de teste.** Preparar build versionado, janela, mecanismo de interrupção e ensaio de recuperação. Confirmar bucket privado e chave de serviço restrita ao servidor. Homologar somente com dados e documentos sintéticos, domínio de e-mail de teste, Preview protegido e sem destinatários reais. Aplicar um limite efetivo de corpo e de frequência no upload antes de expor a rota a testadores externos. O limite do arquivo verificado depois de `formData()` não limita por si só a leitura de todo o corpo quando o cabeçalho é omitido.

### Antes de produção ou de qualquer uso de dados reais

- **Documentação.** Integrar varredura antimalware e quarentena antes de liberar visualização. Validar arquivos com tipo, conteúdo, tamanho e formato. A implementação atual usa extensão, MIME, assinatura e terminador. Centralizar downloads para impor o TTL, pois o cliente administrativo usa assinatura direta no Storage e um cliente autorizado pode solicitar outra duração. Testar expiração, cache e revogação. [Validação de arquivos](../src/lib/medicalFile.ts) · [Downloads privados](https://supabase.com/docs/guides/storage/serving/downloads) · [Cache de URLs assinadas](https://supabase.com/docs/guides/storage/cdn/smart-cdn)
- **Minimização e retenção.** Limitar CPF, contato e outros campos cadastrais por papel, revisar o alcance global dos perfis SaaS e separar contas operacionais. Definir retenção, expurgo, preservação de versões e trilha de auditoria, inclusive de coordenadas. Revisar variáveis privilegiadas e remover da aplicação as que forem desnecessárias em mudança autorizada. [Hidratação dos dados administrativos](../src/services/supabaseService.ts)
- **Integridade financeira.** Revisar baixa pelos RPCs legados, cancelamento de plantão com valor em aberto, transição após pagamento e uso de texto livre em campos operacionais que continuam visíveis. Manter motivo e autoria em mudanças com efeito financeiro. O teste de sigilo deve cobrir erros e contagens, além de colunas e arquivos exportados. [RPCs financeiros legados](../supabase/11_finance_module.sql) · [Regras e auditoria financeiras](../supabase/22_payment_terms.sql)
- **Operação.** Aprovar prazo de retenção, limites, alertas e processo de resposta a incidente. GPS fornecido pelo navegador deve ser tratado como evidência operacional, com verificação e trilha para exceções. Rodar a revisão de dependências e os testes autenticados completos no build candidato antes da publicação.

## Pré-verificação de compatibilidade

As hipóteses abaixo vêm de restrições do código. As ocorrências e quantidades nos dados reais não foram confirmadas. Fazer somente consultas agregadas em sessão administrativa autorizada e de leitura, com timeout, sem retornar CPF, e-mail, caminho de arquivo, valor ou coordenadas.

| Inventário | Condição para seguir |
| --- | --- |
| Esquema e ACL | Comparar tabelas, colunas, índices, FKs validadas, funções, triggers, RLS e políticas de origem. Confirmar os nomes removidos nas 19 e 25 e a versão do validador da 15. Registrar diferenças e encerrar a janela diante de aplicação parcial. |
| Identidade e empresa | Contar duplicidades de CPF, CRM e UF e e-mail normalizados por empresa. Identificar vínculos fora do tenant, contas inativas e substituição de unidades ou especialidade na aprovação de legado. Cada colisão precisa de tratamento definido. |
| Escala | Contar horários inválidos, sobreposições, postos e unidades inativos com plantões futuros, vínculos inconsistentes e vagas sem especialidade explícita. Definir quais registros permanecem históricos e quais exigem correção antes da ativação do fluxo. |
| Financeiro | Contar pagos sem data ou sem médico, pagos cancelados, pendentes sem vencimento e empresas sem regra mensal. Definir política para legados sem recalcular valores ou vencimentos já pactuados sem revisão. |
| Documentação | Contar arquivos sem objeto correspondente, caminhos fora do prefixo empresa/médico, URLs legadas, arquivos acima de 4 MB e aprovações sem validade exigida. Validar formato dos catálogos JSON e referências a arquivos anteriores. Arquivo inconsistente deve falhar fechado no download. |
| Exclusão e retenção | Verificar rotas antigas de exclusão de médico, empresa, posto, unidade e plantão com novos FKs. Onde houver histórico, definir cancelamento ou arquivamento e mensagem operacional. Validar limpeza controlada de arquivos órfãos após falhas de upload. |

## Backup e rollback

**Estado observado.** O painel do Supabase informa que o plano Free não inclui backups do projeto. Nenhum backup externo ou ponto de recuperação foi comprovado nesta auditoria. O backup lógico é possível mediante acesso administrativo funcional e autorização. O backup do PostgreSQL cobre metadados do Storage, enquanto os binários exigem cópia separada. [Backups do Supabase](https://supabase.com/docs/guides/platform/backups)

1. **Preparar antes da janela.** Registrar ambiente, commit/build, sequência aplicada e versões de PostgreSQL, políticas, triggers e grants. Definir responsáveis, tempo máximo de parada e perda aceitável de dados. Produzir backup criptografado e verificado de esquema, dados e papéis com procedimento compatível com Supabase. Confirmar separadamente o escopo de Auth, Storage e objetos personalizados nos esquemas gerenciados. Registrar configuração de redirects, SMTP, integrações e segredos no cofre apropriado. Copiar arquivos dos buckets e versões relevantes com manifesto e verificação de integridade.
2. **Ensaiar a restauração.** Restaurar primeiro em destino isolado autorizado. Conferir contagens, integridade de FKs, perfis Auth, políticas, assinatura e abertura de amostras sintéticas, além de leitura e escrita de escala. Registrar tempo observado e ponto efetivo de recuperação. Usar o par de aplicação e esquema de origem para esse ensaio.
3. **Tratar falha entre scripts.** Interromper a sequência, levantar quais transações confirmaram e preservar logs. Priorizar correção para frente que mantenha as restrições. Como não há scripts de reversão validados, qualquer retorno de schema exige procedimento revisado ou restauração coordenada. Evitar reaplicar arquivos às cegas ou reabrir privilégios amplos para compatibilidade.
4. **Tratar falha depois de novas escritas.** Congelar escrita, preservar a trilha e os dados posteriores ao backup e decidir como conciliá-los. Retornar a aplicação, o esquema e o Storage de forma coerente. O Instant Rollback muda o deploy servido e conserva a configuração daquele build. O banco externo precisa de seu próprio plano. A versão antiga contra as migrations 24 e 25 continua incompatível. [Rollback de deploy na Vercel](https://vercel.com/docs/instant-rollback)

## Checklist de homologação

Todos os cenários abaixo estão **pendentes no Supabase real de homologação**. Os 61 testes JavaScript passaram novamente nesta revisão. O SQL integrado e a concorrência em duas conexões passaram na validação anterior com PostgreSQL descartável e dados sintéticos. Os arquivos SQL de verificação contêm operações de escrita e devem ser reservados a uma base descartável autorizada. [Suíte SQL](../supabase/portal.verify.sql)

| Cenário | Resultado esperado e critério de aprovação |
| --- | --- |
| Isolamento e configuração | Build de Preview com projeto, Auth, chave de serviço e buckets distintos. Usuários sintéticos e e-mails controlados. Nenhuma requisição da aplicação de teste chega ao Supabase de produção. |
| Linha de base e aplicação | Catálogo de origem registrado e sequência 19–25 aplicada uma vez após autorização. Comparação de esquema confirma todos os objetos e permissões, sem divergência ou etapa parcial. |
| Sessões e perfis | Anônimo, conta inativa e conta com troca de senha pendente não leem dados nem executam RPCs protegidas. Após trocar a senha, somente as permissões do perfil voltam. Testar dois tenants, coordenação, escalista, financeiro leitura, financeiro edição e médico. |
| Credenciamento | E-mail confirmado e critérios de correspondência completos permitem vínculo legado. Rejeitado, pendente legado ou vínculo de outro tenant não abre a pasta. Aprovação, rejeição e correção geram histórico. Desativação e suspensão seguem a política de revogação aprovada. |
| Upload, revisão e download | PDF e imagem válidos entram por rota protegida. Tipo falso, corpo excessivo, troca de ID, objeto fora do prefixo e acesso entre empresas são negados. Envio direto ao bucket falha. Expiração, autoria, validade, motivo de rejeição e acesso a versão anterior são verificáveis. |
| Sigilo e integridade financeira | Escalista e médico não obtêm valores por tabela, visão, RPC, exportação ou erro. Leitor financeiro enxerga somente seu escopo e não altera. Editor registra baixa e auditoria. Vencimentos cobrem virada de ano, feriados e meses curtos sem alterar valores históricos. |
| Escala e concorrência | Vaga, troca e cancelamento respeitam unidade, especialidade, documento e horário noturno. Duas aprovações simultâneas deixam um responsável, uma candidatura selecionada e um evento de auditoria. Posto desativado mantém histórico e não recebe novos plantões. |
| Presença móvel | HTTPS em aparelho real. Dentro do raio e com precisão adequada registra presença. GPS recusado, fora da área, duplicidade e check-out prematuro recebem tratamento esperado. Exceção exige papel e justificativa, e coordenadas ficam fora de respostas e logs operacionais. |
| Relatórios e avisos | Indicadores e filtros conferem com dados sintéticos de referência. CSV e XLSX respeitam campos por perfil e neutralizam fórmulas. Lembretes e decisões respeitam preferências e deduplicação no fluxo previsto. |
| Compatibilidade e reversão | Simular troca de versão e aba antiga em Preview protegido. O par novo funciona e o retorno ensaiado recupera autenticação, escala, finanças e arquivos dentro do tempo e perda aprovados. |
| Aceite | Todos os bloqueios anteriores à homologação resolvidos. Nenhuma falha de isolamento, acesso financeiro ou documental, perda de histórico ou dependência não testada no caminho crítico. Evidências revisadas pelos responsáveis pelo ambiente e pela segurança. |

A autorização para provisionar, aplicar, corrigir o ambiente, testar escrita ou restaurar deve identificar o destino e o escopo. O parecer pode ser revisado quando houver um ambiente isolado, uma linha de base verificada e as correções bloqueantes.
