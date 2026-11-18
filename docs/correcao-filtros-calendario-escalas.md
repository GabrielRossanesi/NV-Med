# Correção de filtros e calendários de escalas

## Causa identificada

O calendário aplicava filtros a um resumo de turno: encontrar um único plantão com o status escolhido fazia o turno inteiro passar. Em seguida, renderizava todos os médicos, vagas e postos previstos daquele turno. A lista aplicava condições independentes por plantão. Isso misturava médicos com vagas no calendário e produzia resultados diferentes entre visualizações.

Havia outras inconsistências relacionadas:

- O filtro rápido de vagas da lista verificava apenas a ausência de médico. Postos previstos ainda não criados também apareciam como vagas nos cartões.
- A publicação de cobertura da Master não fazia parte dos dados da grade. Um posto sem médico pode continuar reservado para revisão e não estar disponível para candidatura.
- Os filtros de contratação, médico e documentação localizavam um turno correspondente, mas deixavam aparecer colegas que não correspondiam ao filtro.
- Regulares/Avulsos só atuava na lista; alternar visualizações deixava de aplicar esse recorte. A lista usava o mês inteiro mesmo depois de uma seleção semanal ou diária.
- No cartão mensal, nome e horário disputavam a mesma linha. `truncate` cortava o nome antes de aproveitar uma segunda linha.

O carregamento existente em `supabaseService` consulta `nv_staff_shifts` com as permissões do usuário, ordena por ID e percorre páginas de 500 até concluir. Não foi identificada uma limitação fixa de uma página nesse caminho. Os filtros de apresentação são aplicados ao conjunto autorizado já carregado, sem consultas por célula. Não foi necessário substituir esse carregamento nem modificar os dados existentes.

## Implementação

`scheduleFiltering.ts` centraliza as condições por plantão, consumidas pelo calendário, pelo painel lateral e pela lista. Os filtros se intersectam no mesmo registro: situação, contratação, médico, especialidade, turno, documentação e regular/avulso. A classificação de turno continua usando os períodos configurados e as regras existentes.

**Vaga aberta disponível** exige posto salvo, status `open`, ausência de médico, início futuro, ausência de pagamento consolidado e publicação permitida. A nova RPC somente leitura `nv_schedule_available_vacancies` verifica essas condições no banco e retorna os IDs em lote. Reutiliza a autorização administrativa de visualização e a configuração existente `master_coverage_publication`; não cria novo estado de negócio nem muda o processo de candidatura.

Não é necessário existir uma candidatura ou oportunidade já criada para a vaga normal estar disponível: o fluxo existente cria essa oportunidade na primeira candidatura. As restrições pessoais de credenciamento, documentação, vínculos, afastamento e conflito continuam sendo verificadas pelo Portal e pelo banco quando um profissional se candidata. A lista administrativa de vagas não promete elegibilidade de todos os médicos.

`useAvailableScheduleVacancies` atualiza a consulta quando mudam empresa, plantões ou revisão de candidaturas, e a cada minuto. Respostas de uma seleção anterior são descartadas. Falha na consulta não transforma postos sem médico em vagas: o filtro permanece sem resultados confirmados e apresenta o erro. Novas atribuições, remoções, confirmações ou publicações recarregam os plantões pelo fluxo existente.

Postos sem médico fora desse conjunto são identificados como **Posto sem médico**. Previsões da cobertura usam **Posto previsto por criar**. Nenhum desses dois grupos entra no filtro de vagas disponíveis. Cancelados, concluídos e plantões iniciados também não entram. Dias sem resultados mantêm sua posição e data, sem repetir “Sem plantões” ou contagens zero.

## Componentes e apresentação

- `ScheduleCalendarView` constrói os resumos e aplica o filtro compartilhado. O painel lateral conserva dados completos do plantão e ações conforme permissões. A exclusão de um turno inteiro fica oculta quando há filtros, evitando apresentar uma contagem filtrada para uma ação que atingiria plantões ocultos; a exclusão individual e o gerenciamento explícito continuam disponíveis.
- `ScheduleMonthGrid` atende mês, semana e dia. A semana tem sete colunas, de segunda a domingo, mantendo a sequência de datas inclusive na virada do mês. O cabeçalho fica fixo na rolagem e o dia atual recebe destaque discreto. As células da mesma linha têm altura alinhada e não possuem rolagem interna.
- `ScheduleAllocationList` é o cartão compartilhado pelos três calendários, com ícone, nome, setor quando necessário e faixa de horário abaixo do nome. O mês usa até duas linhas para o nome; semana/dia permitem quebra completa. O tooltip contém o nome e contexto completos. No celular, tocar o dia abre os nomes completos no painel.
- A lista da página usa o mesmo predicado e a mesma distinção de disponibilidade. Os nomes quebram em linhas e oferecem tooltip. Ao entrar na lista a partir do calendário, mantém o intervalo semanal, diário ou mensal selecionado; sua navegação segue esse intervalo.
- Regulares/Avulsos passa a atuar em todos esses modos, sem forçar uma troca para a lista. A seleção multissetorial e os filtros permanecem no estado da página ao alternar Geral/Master e modos de calendário.

Sem filtros, os indicadores de ocupação usam médicos atribuídos e postos previstos, incluindo avulsos. Confirmação pendente ocupa um posto. Com filtros, o cabeçalho do dia mostra a quantidade de resultados, como “2 vagas”, e identifica isso como contagem filtrada. O total operacional permanece no tooltip, na descrição acessível e nos detalhes do dia. O resumo separado **Cobertura operacional · unidade, setores e turno** mantém seu escopo explícito, sem se apresentar como contagem de resultados de situação/médico/documentação.

Telas menores mantêm o calendário com rolagem horizontal dentro da grade; a página não ganha rolagem lateral. A visualização diária oferece uma alternativa de uma coluna. Não foram reduzidos os nomes a uma fonte menor para fazê-los caber.

## Banco, permissões e implantação pendente

A RPC de disponibilidade foi acrescentada à **migration 38 ainda local e não aplicada**, junto do trabalho anterior de filtros, cadeado e auditoria. Ela é de leitura, exige acesso à empresa e não concede escrita. A migration 37, o Cron, as regras de recorrência e os fluxos de candidatura não foram alterados nesta correção. Não há nova migration nem alteração de dados de escalas, vínculos ou confirmações.

A publicação precisa aplicar a versão atual da 38 antes de disponibilizar a interface. A preparação inicial foi mantida localmente, sem migration em produção, commit ou deploy. A implantação foi autorizada posteriormente pelo usuário e tem seu resultado registrado separadamente.

## Validação

- **137 testes automatizados aprovados**, incluindo vagas exclusivas em mês/semana/dia e no painel, disponibilidade não inferida de médico ausente, passado, pagamento consolidado, cancelamento, preenchimento, interseção de filtros e coerência entre lista e grade. Também cobrem nomes longos, ordem por horário, equipes numerosas, contadores, setores múltiplos, avulsos e semanas entre meses.
- Suíte SQL em PostgreSQL descartável: baseline 01–18, migrations 19–38, suítes anteriores e regressão da Master. A consulta nova foi validada com vaga normal, cobertura não publicada/publicada, posto preenchido, cancelado, vencido, tentativa de outra empresa e perfil do Portal sem autorização administrativa. As transações de teste usam dados sintéticos e rollback.
- TypeScript, lint dos componentes alterados e build de produção com credenciais de produção desativadas.
- Navegador com componentes reais e API local fictícia: vagas exclusivas, turno noturno, mesma vaga na lista, Confirmado sem vagas, navegação mensal e semanal com filtro ativo, semana de 30/11 a 06/12, horários diurnos/noturnos, nomes longos e dia com dez médicos. Verificados desktop, tablet de 768 px e celular de 390 px, sem transbordamento horizontal da página. A semana apresentou sete células de mesma altura; os detalhes móveis exibiram o nome completo.

A validação não acessou nem modificou produção. O teste visual usa API fictícia e o teste SQL usa banco real descartável; a combinação não substitui a futura validação com contas reais no ambiente publicado. A disponibilidade exibida é atualizada na carga, em alterações locais e periodicamente em até um minuto; mudanças feitas em outra sessão dependem da próxima atualização ou recarga. Todas as ações de candidatura continuam sujeitas à validação transacional do servidor.
