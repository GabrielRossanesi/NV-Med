# Cobertura fracionada de plantões

O posto previsto registra a demanda da unidade. Um posto guarda o período, o fuso operacional, a capacidade simultânea e o recorte de empresa, unidade, setor e especialidade. Cada trecho continua sendo um plantão em `public.shifts`. A alocação e a vaga têm identificadores próprios e mantêm os fluxos de credenciamento, aprovação, presença, candidatura, auditoria e pagamento.

## Cadastro e edição

Na Escala Geral, abra uma ficha e marque **Fracionar cobertura**. Em um plantão existente, seus horários antes da conversão se tornam o período previsto. Para um novo posto, informe o período previsto e os horários do primeiro trecho. Use **Editar período previsto** para ajustar o período ou a capacidade de um posto cadastrado. A revisão precisa acomodar as demais alocações.

A ficha mostra a linha do tempo, as horas previstas, cobertas e descobertas e a quantidade de médicos. Cada trecho salvo abre sua ficha. Escolha um médico e ajuste o horário dentro da vaga para preencher uma parte. Para liberar um intervalo, remova o médico ou cancele a alocação conforme as permissões e confira a prévia antes de salvar. **Cancelar posto** encerra a demanda e os trechos ativos, preservando os registros.

Na Escala Master, marque **Definir período do posto** e informe a alocação do médico fixo e a capacidade prevista. A geração cria o posto e a alocação recorrente e deriva os intervalos descobertos. As ocorrências fracionadas já materializadas são preservadas nas revisões da recorrência. Ajustes pontuais são feitos na Escala Geral.

As operações antigas de copiar dia ou semana se aplicam a plantões regulares sem um posto fracionado vinculado. Reproduza postos fracionados recorrentes pela Escala Master.

## Persistência e concorrência

- A migration `52_fractional_coverage.sql` acrescenta `shift_coverage_posts`, um vínculo opcional em `shifts` e índices. O cadastro inicial não reescreve registros legados.
- A conversão mantém o ID do plantão de origem. Alocações, vagas derivadas e eventos de auditoria podem ser consultados pelo posto previsto.
- A rotina separa os intervalos pelos limites das alocações e calcula quantas posições faltam em cada trecho semiaberto. Vagas com os mesmos limites são reaproveitadas. Vagas obsoletas são canceladas para manter candidaturas e histórico.
- O PostgreSQL valida os limites em minutos no fuso da unidade. Horários iguais no posto fracionado indicam o mesmo horário do dia seguinte. Em regiões com mudança de fuso, a duração efetiva corresponde ao tempo entre os instantes registrados.
- Uma trava transacional por posto e a revisão da ficha evitam gravações concorrentes inconsistentes. O RPC retorna os registros do posto afetado. Leituras da escala seguem o lote já usado por `nv_staff_shifts`.
- As tabelas internas de cobertura são privadas. A leitura segue as permissões da view administrativa e os RPCs exigem acesso à empresa e à ação. A confirmação, o bloqueio documental e os impedimentos financeiros continuam sendo verificados nas operações de plantão.

## Portal Médico e financeiro

Vagas derivadas aparecem imediatamente na Escala Geral. Publique a vaga na ficha para disponibilizá-la no Portal Médico. Em uma vaga publicada com oportunidade aberta, use a fila de candidaturas para selecionar o responsável ou retire a publicação antes de atribuir pelo formulário. O encerramento preserva a decisão e o histórico.

O valor por hora é opcional para uma alocação PJ. O servidor multiplica o valor em centavos pela duração efetiva e arredonda o total para centavos. O acordo, os pagamentos à vista e os ajustes usam a alocação como referência. O posto previsto não gera pagamento próprio. A apuração de receita continua usando as regras e medições contratuais de faturamento. Uma vaga descoberta só tem impacto faturável se a apuração do contrato assim determinar.

O painel distingue cobertura integral, parcial e horas descobertas. Os relatórios CSV e XLSX incluem o ID do posto, a data operacional e os minutos do trecho quando o resultado contém cobertura fracionada. Use o ID para consolidar os segmentos sem duplicar a contagem de postos.

## Implantação e recuperação

Aplique a migration 52 somente após as migrations anteriores e depois da validação em homologação. Execute `scripts/test-database.ps1` contra o PostgreSQL descartável. O teste da cobertura usa cadastros sintéticos e inclui geração, publicação, candidatura, valores e isolamento.

Antes da implantação, preserve um backup e confirme a restauração em homologação. Se houver registros fracionados, mantenha a migration vigente ao reverter a aplicação e suspenda a edição desse recurso até publicar a correção. Os vínculos e o histórico são necessários para interpretar os registros gerados. Uma eventual reversão do esquema deve ser planejada a partir do backup e dos registros criados após a implantação.
