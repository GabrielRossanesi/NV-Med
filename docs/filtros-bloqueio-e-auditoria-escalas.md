# Filtros, bloqueio e auditoria das escalas

## Comportamento

O ajuste posterior de vagas exclusivas, cartões compartilhados, contadores e nomes completos está descrito em [correção dos filtros e calendários](correcao-filtros-calendario-escalas.md). A migration 38 também inclui a consulta de disponibilidade em lote, sem alterar as regras da 37.

A seleção da escala aceita vários setores ativos de uma unidade, com pesquisa, contagem, limpeza e a opção **Todos os setores**. Essa opção é dinâmica: inclui setores novos autorizados da unidade. Uma seleção explícita permanece explícita. Trocar a unidade elimina os setores anteriores; Geral e Master compartilham a seleção. Uma seleção vazia não pode virar uma consulta ou exclusão de todos os setores.

O calendário mensal identifica os médicos uma vez por plantão e informa discretamente o setor quando há vários setores selecionados. Vagas e confirmações continuam distintas. As consultas da Master reutilizam a visão existente e recebem o conjunto de setores em uma única RPC; não há consulta por célula. Cópia e exclusão em lote respeitam o recorte selecionado.

## Administração e Portal Médico

- Somente contas administrativas ativas com permissão efetiva `escala.edit` podem ver e desbloquear o cadeado. Criar, excluir e aprovar também exigem suas respectivas ações e edição efetiva. Negar edição bloqueia essas operações mesmo quando existe outra concessão genérica.
- Médico e Coordenador Médico são perfis profissionais do Portal Médico. Não recebem acesso administrativo por cargo, por concessão genérica ou por uma exceção de ação. Continuam consultando as escalas autorizadas pelo Portal, conforme credenciamento e vínculos, usando os fluxos validados de candidatura e solicitação de troca.
- Coordenador de Escalas é um cargo administrativo diferente de Coordenador Médico. Um médico que também tenha uma conta administrativa legitimamente provisionada usa as permissões dessa conta no painel; o vínculo de coordenador médico por si só não concede esse acesso.
- Histórico exige `escala.history`, independentemente de edição. Diretor, Gerente e Coordenador de Escalas têm a permissão por cargo; outros usuários administrativos podem recebê-la explicitamente. Para SaaS, permanecem os cargos autorizados, sem exceções individuais. Negativas individuais são respeitadas.

A migration 38 centraliza essas condições em `nv_profile_action`, usado pelas políticas RLS e RPCs existentes. Mantém as políticas restritivas e a revogação de INSERT/UPDATE direto de plantões. As tabelas privadas da Master e da auditoria continuam sem acesso direto dos clientes. Os fluxos do Portal usam suas próprias operações validadas; não recebem permissão de escrita administrativa.

O modelo atual concede às contas administrativas acesso às unidades da própria empresa segundo as permissões existentes. Não foi criado um novo vínculo de unidades por usuário. A seleção limita a visualização, sem ampliar autorização. O servidor verifica empresa, unidade e todos os IDs de setores recebidos.

## Cadeado

Cada aba começa bloqueada e exige confirmação para ativar a edição. O estado não é salvo em armazenamento compartilhado. Mudanças de usuário, empresa ou permissões reiniciam o controle.

O prazo é de cinco minutos medidos pelo relógio e se renova com interações nos formulários de edição. Movimento do mouse, rolagem e navegação de leitura não renovam o prazo. O tempo em segundo plano conta como inatividade. Ao retornar à aba, o cadeado só fecha se o prazo venceu. Uma gravação em andamento termina antes de concluir o bloqueio. Cada ação de escrita verifica o controle novamente.

Rascunhos alterados permanecem no formulário bloqueado. O diálogo permite **Retomar para salvar**, **Descartar e bloquear** ou **Manter rascunho bloqueado**. Retomar exige a confirmação explícita e devolve o usuário ao formulário para validação e salvamento. Não salva automaticamente campos inválidos. Fechar o editor, trocar o recorte ou usar Voltar pede a decisão quando há alterações. Uma entrada temporária no histórico da aba protege o retorno pelo navegador; ela não contém dados de formulário nem estado de desbloqueio. Saídas e recargas com rascunho usam também a proteção nativa de `beforeunload`.

O cadeado é uma proteção operacional da interface. A autorização para escrever é sempre verificada novamente no banco. O Cron não depende do cadeado da interface.

## Histórico administrativo

Reutiliza `master_schedule_audit`, ampliada com usuário e cargo no momento da operação, origem, unidade, setor e valores anteriores/novos. Os gatilhos do servidor registram criação, edição, cancelamento, exclusão, atribuição/remoção/substituição de médico, regras e afastamentos. O usuário não envia o autor nem o horário do registro.

Os registros de uma entidade na mesma transação são consolidados por gatilhos diferidos. Isso elimina o cancelamento temporário de uma ausência durante a edição. Rollback também reverte a auditoria. O estágio fica no schema privado e é consumido na transação, sem criar um segundo histórico persistente.

Os snapshots incluem dados operacionais permitidos. Valores financeiros, diagnósticos e o conteúdo de observações privadas não entram na linha do tempo; uma alteração de observação gera somente a indicação de atualização. Os detalhes técnicos existentes de geração/publicação permanecem no histórico privado. A origem histórica das ocorrências da Master continua disponível mesmo após sua liberação da recorrência.

As origens distinguem manual, Master, aprovação de candidatura/troca, Portal e Cron. O Cron é identificado como processo automático sem atribuí-lo a uma sessão humana. Importações futuras podem informar a origem por contexto privado do processo autorizado, sem aceitar um campo de origem fornecido pelo cliente. Não há recategorização automática das importações antigas.

A interface oferece filtros de data da alteração, usuário, unidade, setor, operação e plantão, com páginas de 30 itens. Horários são exibidos em `America/Sao_Paulo`. Há acesso geral e por plantão. Registros legados permanecem preservados; nomes/cargos antigos não são reconstruídos a partir do cargo atual.

## Migração e publicação

1. Aplicar `supabase/38_schedule_controls_and_audit.sql` **após a 37 e antes de disponibilizar a interface correspondente**, no destino confirmado. É transacional, com espera de lock limitada a cinco segundos. Não reaplicar o arquivo inteiro sobre um esquema já atualizado.
2. A migration não cria nem altera escalas, vínculos, confirmações, regras ou ausências reais. Amplia a auditoria e reforça os verificadores de autorização. Não muda concessões individuais armazenadas.
3. O job `nvmed-master-daily` e seu horário permanecem configurados como antes. A função executada pelo job é atualizada mantendo sua identidade e restrições de execução, para registrar a origem automática corretamente.
4. Publicar a versão correspondente e validar com contas administrativas de edição/leitura e contas do Portal. Não executar as suítes sintéticas no banco de produção.

A preparação e os testes foram executados localmente, sem criação de dados de teste na produção. Após autorização do usuário, a migration 38 foi aplicada e a versão correspondente foi publicada no domínio principal em 18/11/2026. O [registro da implantação](publicacao-escalas-migration38.md) reúne os resultados.

## Validação executada

- `npm test`: **137 testes aprovados**, incluindo seleção dinâmica, deduplicação, setores externos/inativos, escopo vazio, exclusão em lote, calendário mensal, perfis profissionais e prazo de edição.
- `scripts/test-database.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\16\bin'`: laboratório PostgreSQL descartável, baseline 01–18 e migrations 19–38. Executa as suítes existentes, a nova `schedule-controls.verify.sql` e a regressão da Master novamente após a 38.
- SQL: bloqueio de concessões indevidas, escrita direta/RPC por Coordenador Médico, auditoria sem permissão específica, isolamento entre empresas, paginação, snapshots, privacidade, identidade automática do Cron, edição consolidada de afastamento e preservação dos fluxos reais de candidatura/aprovação/troca no laboratório.
- TypeScript, lint dos arquivos alterados e compilação de produção com Supabase desativado pelo comando `npm run build:local`.
- Navegador com componentes reais e dados/RPC fictícios locais: desktop e 390 px, vários setores, troca de unidade, Geral/Master, calendário mensal, histórico, diferentes perfis, confirmação do cadeado, expiração real de 60 segundos, rascunho preservado, Voltar e abas independentes. A captura de tela usa somente nomes fictícios.

A inspeção visual não usou contas reais nem gravou dados de produção. A condição de aba oculta está implementada, mas não foi reproduzida fisicamente na inspeção automatizada, pois o navegador manteve as abas de teste como visíveis. O laboratório não mede o volume real de auditoria ou a carga de produção; acompanhar esses indicadores na implantação.
