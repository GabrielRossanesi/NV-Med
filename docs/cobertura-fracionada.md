# Cobertura fracionada de plantões

O posto previsto registra a demanda da unidade. Um posto guarda o período, o fuso operacional, a capacidade simultânea e o recorte de empresa, unidade, setor e especialidade. Cada trecho continua sendo um plantão em `public.shifts`. A alocação e a vaga têm identificadores próprios e mantêm os fluxos de credenciamento, aprovação, presença, candidatura, auditoria e pagamento.

## Cadastro e edição

Na Escala Geral, abra a ficha de um posto, plantão ou vaga. Use a barra ou a lista do painel **Cobertura do posto** para editar um intervalo. O editor preenche os horários do trecho. Para uma vaga, selecione o médico e use o intervalo completo ou ajuste os horários dentro dele. **Dados operacionais** reúne os ajustes autorizados de capacidade e de período.

**Adicionar médico** sugere o primeiro trecho disponível. Com cobertura integral, selecione uma alocação para dividir ou substituir o médico. **Dividir plantão** preserva o primeiro médico e pode deixar o segundo intervalo como vaga. **Aplicar alteração** atualiza o rascunho. **Salvar plantão** registra todos os trechos e vagas em uma transação.

Cada trecho salvo abre sua própria ficha na Escala Geral. Escolha um médico e ajuste o horário dentro da vaga para preencher uma parte. Para liberar um intervalo, remova o médico ou cancele a alocação conforme as permissões e confira a prévia antes de salvar. **Cancelar posto** encerra a demanda e os trechos ativos, preservando os registros.

Na Escala Master, marque **Definir período do posto** e informe a alocação do médico fixo e a capacidade prevista. A geração cria o posto e a alocação recorrente e deriva os intervalos descobertos. As ocorrências fracionadas já materializadas são preservadas nas revisões da recorrência. Ajustes pontuais são feitos na Escala Geral.

As operações antigas de copiar dia ou semana se aplicam a plantões regulares sem um posto fracionado vinculado. Reproduza postos fracionados recorrentes pela Escala Master.

## Persistência e concorrência

- A migration `53_fractional_coverage.sql` acrescenta `shift_coverage_posts`, um vínculo opcional em `shifts` e índices. O cadastro inicial não reescreve registros legados.
- A conversão mantém o ID do plantão de origem. Alocações, vagas derivadas e eventos de auditoria podem ser consultados pelo posto previsto.
- A rotina separa os intervalos pelos limites das alocações e calcula quantas posições faltam em cada trecho semiaberto. Vagas com os mesmos limites são reaproveitadas. Vagas obsoletas são canceladas para manter candidaturas e histórico.
- O PostgreSQL valida os limites em minutos no fuso da unidade. Horários iguais no posto fracionado indicam o mesmo horário do dia seguinte. Em regiões com mudança de fuso, a duração efetiva corresponde ao tempo entre os instantes registrados.
- Uma trava transacional por posto e a revisão da ficha evitam gravações concorrentes inconsistentes. O RPC retorna os registros do posto afetado. Leituras da escala seguem o lote já usado por `nv_staff_shifts`.
- A migration `55_interactive_shift_coverage.sql` reaproveita os validadores de plantão, aplica o lote sob a mesma revisão do posto e reconcilia as vagas uma vez. Um erro reverte toda a operação. Alocações encerradas ou pagas usam os fluxos de ajuste existentes. O acordo PJ é recalculado conforme a duração ou a referência configurada para o trecho, sem copiar pagamentos de outra alocação.
- As tabelas internas de cobertura são privadas. A leitura segue as permissões da view administrativa e os RPCs exigem acesso à empresa e à ação. A confirmação, o bloqueio documental e os impedimentos financeiros continuam sendo verificados nas operações de plantão.

## Portal Médico e financeiro

Vagas derivadas aparecem imediatamente na Escala Geral. Publique a vaga na ficha para disponibilizá-la no Portal Médico. Em uma vaga publicada com oportunidade aberta, use a fila de candidaturas para selecionar o responsável ou retire a publicação antes de atribuir pelo formulário. O encerramento preserva a decisão e o histórico.

O valor por hora é opcional para uma alocação PJ. O servidor multiplica o valor em centavos pela duração efetiva e arredonda o total para centavos. O acordo, os pagamentos à vista e os ajustes usam a alocação como referência. O posto previsto não gera pagamento próprio. A apuração de receita continua usando as regras e medições contratuais de faturamento. Uma vaga descoberta só tem impacto faturável se a apuração do contrato assim determinar.

O painel distingue cobertura integral, parcial e horas descobertas. Os relatórios CSV e XLSX incluem o ID do posto, a data operacional e os minutos do trecho quando o resultado contém cobertura fracionada. Use o ID para consolidar os segmentos sem duplicar a contagem de postos.

## Implantação e recuperação

Aplique `53_fractional_coverage.sql` após suas dependências. Aplique `55_interactive_shift_coverage.sql` antes de promover a aplicação com o editor interativo. Execute `scripts/test-database.ps1` no PostgreSQL descartável e `scripts/interactive-coverage.browser.mjs` com o navegador de homologação. Os testes usam cadastros sintéticos.

Antes da implantação, preserve um backup e confirme a restauração em homologação. Se houver registros fracionados, mantenha a migration vigente ao reverter a aplicação e suspenda a edição desse recurso até publicar a correção. Os vínculos e o histórico são necessários para interpretar os registros gerados. Uma eventual reversão do esquema deve ser planejada a partir do backup e dos registros criados após a implantação.
