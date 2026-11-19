# Complementos de controle e auditoria de escalas

## Inspeção da versão existente

As funcionalidades principais já estavam na versão publicada com as migrations 37/38: seleção multissetorial com pesquisa/Todos/limpeza, calendários compartilhados, cadeado por aba com prazo de 60 segundos, permissões administrativas separadas do Portal e histórico paginado gerado pelo banco. Elas foram reutilizadas, sem criar outra escala, trilha de auditoria ou estrutura de cargos.

O cargo administrativo existente no banco continua sendo **Coordenador de Escalas**. Ele corresponde à coordenação administrativa descrita no pedido e permanece distinto de **Coordenador Médico**, identificado no credenciamento do Portal. Não foram renomeados cargos armazenados nem concedidos poderes administrativos aos profissionais médicos.

## Ajustes da interface e do cadeado

- O botão bloqueado passa a exibir **Edição bloqueada · Desbloquear**. Médico e Coordenador Médico continuam sem esse controle.
- O controle consulta o estado atual de usuário, empresa e permissões antes de iniciar a gravação. O backend continua consultando as permissões efetivas do banco em cada RPC, inclusive após revogação durante a sessão.
- Mudar permissões na mesma sessão não remonta mais o editor nem apaga seu rascunho. A revogação bloqueia a escrita e explica que a autorização não está disponível. Restaurar a permissão não desbloqueia automaticamente: exige nova confirmação.
- O diálogo de rascunho bloqueado não reabre a cada renderização. Um formulário aberto, mesmo ainda não alterado, recebe a opção de novo desbloqueio ao expirar o prazo. Não há salvamento automático.
- O cadastro de setor aberto pela escala também utiliza esse controle, incluindo seu rascunho e validação antes da escrita. O fluxo normal em Unidades mantém sua autorização própria. As confirmações das prévias de cópia e recorrência ficam desabilitadas quando a escala está bloqueada.
- O histórico individual mantém obrigatoriamente o ID do plantão selecionado. Trocar unidade/setor no histórico geral elimina filtros de plantão incompatíveis. A opção de reutilizar os setores da escala deixa de aparecer ao escolher outra unidade.
- A linha do tempo identifica a empresa e oferece um detalhe com IDs do registro, usuário, plantão/entidade e correlação. Eventos do Cron mostram **Sistema — Geração automática**. Nenhuma ação de reversão foi implementada.

Os filtros multissetoriais, os cartões, a ordenação, os nomes em duas linhas no mês, os tooltips e a distinção entre vaga disponível e posto sem ocupação permanecem na implementação existente. As regressões automatizadas dos calendários continuam na suíte.

## Migration incremental 39

`39_schedule_audit_context.sql` é necessária para completar os metadados que ainda não eram registrados pela 38. Não modifica as migrations 37/38, não altera plantões, médicos, vínculos ou confirmações existentes, não altera Auth, não recria a auditoria e não muda o agendamento ou a função do Cron.

Reutiliza `master_schedule_audit.details` e `nv_master_private.audit_pending`:

- Um gatilho acrescenta aos novos eventos a correlação gerada pelo servidor a partir da transação e os nomes de empresa/unidade/setor no momento do registro. Registros anteriores não recebem valores inventados ou reconstruídos.
- Ausências guardam também seus vínculos de unidade/setor no momento da operação. Uma recorrência movida posteriormente não faz desaparecer a ausência do histórico da unidade original.
- A RPC existente mantém a assinatura, autorização, paginação e snapshots. Passa a entregar esses metadados e uma opção única por usuário, com o último nome registrado, preservando os nomes/cargos históricos dentro de cada evento.
- Alterações do motivo de cobertura recebem um indicador de atualização, sem copiar o conteúdo privado para a auditoria.
- Os campos financeiros e observações privadas continuam fora da projeção de histórico. Os novos detalhes apresentados são explicitamente selecionados; a RPC não passa a expor todo o JSON privado.

Para futuras importações autorizadas, o processo proprietário pode iniciar uma transação e chamar `nv_master_private.begin_schedule_import(org)` antes das escritas. Esse contexto marca os eventos como Importação e é removido por gatilho diferido na mesma transação. Ele não cria capacidade de escrita da Master, não ignora validações de atribuição/exceções e não é executável por anon, authenticated ou service_role. Não se aceita uma origem fornecida pelo frontend ou por uma configuração de sessão forjável. Sem esse marcador, operações diretas do proprietário continuam auditadas como processo do banco, sem inferir que toda operação é importação.

A correlação é compartilhada pelas alterações da mesma transação. Rollback desfaz simultaneamente os dados e o histórico. Não há atualização retroativa da origem de importações antigas. A informação adicional prepara a investigação e eventual evolução futura, sem implementar reversão de escala.

## Dependências e limites

A 39 deve ser aplicada após a 38, uma única vez e somente com autorização explícita para o destino. A interface tolera eventos antigos ou um servidor ainda sem os metadados novos; correlação e nomes históricos completos só estarão disponíveis para eventos posteriores à aplicação. Permissões e isolamento existentes continuam sendo a fronteira de autorização. Não foi criado um novo vínculo administrativo de unidades por usuário.

## Validação

- `npm test`: **140 testes aprovados**, incluindo perfis profissionais sem poderes administrativos, revogação/empresa/identidade no editor, filtros e calendários anteriores, apresentação de correlação, horários de São Paulo, nomes e identificação automática do sistema.
- `scripts/test-database.ps1`: PostgreSQL descartável com baseline 01–18 e migrations 19–39. Inclui as suítes existentes, testes novos de auditoria e repetição das regressões da Master/controles após a 39.
- SQL: correlação do servidor, snapshots preservados após renomear usuário/unidade, usuário único no filtro, paginação, revogação da edição na sessão, importação privada sem capacidade de escrita, rejeição de origem forjada, contexto consumido, ausência consultável após mudança da recorrência, identidade do Cron, grants do trabalhador, rollback conjunto e isolamento entre empresas/Portal.
- TypeScript, lint e build local. No navegador, os componentes reais usaram dados e API fictícios em desktop, tablet (768 px) e celular (390 px). Foram verificados o histórico individual, a paginação, a troca de unidade, o desbloqueio por aba e a preservação do rascunho após revogação ou inatividade. O comportamento em segundo plano foi verificado simulando a mudança de visibilidade.

O controle de rascunhos é temporário e pertence ao editor aberto na aba; não é armazenamento durável após fechar o navegador. O backend protege a gravação quando as permissões reais mudam, mesmo antes de o frontend receber a atualização. Não foi adicionado serviço pago, agendamento novo ou acesso administrativo para o Coordenador Médico.
