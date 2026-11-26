# Banco de dados do NV Med

## Minha conta

A migration `47_staff_account.sql` requer a linha de base da segurança em produção (40–43 e 45–46). Ela acrescenta preferências e atividade pessoais à equipe interna, protege o último TOTP verificado e integra a categoria de candidaturas à central de avisos. Aplique com a versão correspondente da aplicação. Consulte [Minha conta](../docs/minha-conta.md) para os pré-requisitos de Auth, a homologação e os limites operacionais.

`39_schedule_audit_context.sql` reutiliza o histórico e o estágio privados da 38 para correlação transacional, contexto histórico de unidades e importações privilegiadas. Aplique após a 38. [Guia dos complementos](../docs/complementos-controle-auditoria-escalas.md)

Filtros e controle administrativo das escalas: aplicar `38_schedule_controls_and_audit.sql` após a 37 e antes da interface correspondente. Reforça a autorização usada por RLS/RPCs e amplia o histórico existente, sem modificar escalas reais nem reagendar o Cron. [Guia de filtros, bloqueio e auditoria](../docs/filtros-bloqueio-e-auditoria-escalas.md)

Escala Master e afastamentos: aplicar `37_master_schedule.sql` após a 36 e configurar `master-schedule-cron.setup.sql` para geração diária. Não converte escalas importadas. O [guia de recorrências e ausências](../docs/escala-master-e-afastamentos.md) descreve permissões, prévia obrigatória, contratos, laboratório e ativação.

Perfil médico e acesso individual ao portal: aplicar `36_doctor_profile_access.sql` após a 35 e antes da interface correspondente. Não cria contas nem envia convites em lote. O [guia de perfil e acesso](../docs/perfil-medico-acesso-portal.md) descreve inventário somente leitura, separação de credenciamento/Auth, permissões, SMTP e testes.

Os dados bancários médicos usam a migration incremental `32_doctor_banking.sql`, após a 31. Aplique em conjunto com a versão correspondente da interface e com autorização para o destino. O [guia de dados bancários](../docs/dados-bancarios-medicos.md) descreve migração dos valores legados, permissões, proteção e testes locais.

O piloto interno no Supabase existente segue o [plano de implantação controlada](../docs/implantacao-controlada-nv-med.md). O [roteiro de laboratório isolado](../docs/homologacao-nv-med.md) registra os testes locais e a estratégia anterior.

A instalação a partir de um projeto vazio usa os scripts numerados de estrutura, conforme a ordem do roteiro. O arquivo `init_all.sql` é um instalador histórico com carga de demonstração.

Use `homologation.preflight.sql` e `homologation.postflight.sql` para as verificações de leitura no alvo confirmado. Execute `portal.verify.sql` em um banco descartável com interfaces de Auth e Storage. A suíte insere dados sintéticos e reverte a transação.

## Documentação por empresa e cobertura avulsa

- Em **Perfil da empresa → Documentação médica**, configure exigências para todas as unidades (incluindo futuras unidades) ou selecione unidades específicas. Exigências gerais e específicas se somam; especialidades podem restringir cada regra. É necessário ser usuário da empresa com edição em Configurações.
- As alterações criam os itens obrigatórios para médicos abrangidos. Remover a exigência preserva arquivos e histórico.
- Em **Escalas → Plantão avulso**, escolha unidade, setor, especialidade, motivo e datas. Pode deixar vagas abertas ou já indicar o médico. Repetições terminam na data escolhida; o padrão é o último dia do mês.
- Plantões avulsos somam demanda apenas nas datas cadastradas, sem alterar a quantidade fixa do setor. Eles não são incluídos ao copiar semanas ou turnos.
- Aplique `18_ad_hoc_shifts.sql` antes de disponibilizar a interface: adiciona os campos persistidos e valida motivo, especialidade e empresa no banco.

## Valores de plantões e acordos financeiros

- Valide `26_shift_payment_agreements.sql` após a migration 25 em um PostgreSQL descartável, com `scripts/test-database.ps1`. A migration cria a tabela privada de referências, amplia a visão financeira protegida e adiciona os fluxos auditados de alteração e consulta.
- Coordene a disponibilização da migration com a versão correspondente da interface. Os valores padrão servem como referência para novas decisões e os acordos existentes preservam seus valores.
- Depois da baixa, a correção do valor combinado exige edição em Financeiro e em Configurações da empresa, com motivo obrigatório. A modalidade, o vencimento, a data e o valor efetivamente pago são preservados.

## Permissões, setores e relatórios

- Valide `27_effective_permissions.sql` depois da 26 e `28_scoped_sectors_and_reports.sql` depois da 27. Aplique as duas migrations antes de disponibilizar o código correspondente. O laboratório `scripts/test-database.ps1` executa `effective-permissions-and-reports.verify.sql` com dados sintéticos e rollback.
- A migration 27 mantém os cargos e as concessões anteriores. Ela acrescenta exceções por ação, limites de delegação, auditoria de acessos e a proteção do último diretor ou gerente ativo. O administrador SaaS configura as ações delegáveis no formulário de usuários. O cargo Coordenador Médico é uma identificação do credenciamento no portal.
- A migration 28 cruza o catálogo da empresa com os vínculos de unidade e setor. Os relatórios aplicam os filtros no banco antes da prévia ou da exportação. Os dados e filtros financeiros exigem acesso ao Financeiro.

## Referências financeiras por posto

- A migration 29 adiciona referências e modalidade padrão por posto à tabela privada existente. O formulário grava posto e referência em uma operação. Valores de plantões existentes não são recalculados.
- Vagas abertas podem ter acordo registrado sem médico. O vencimento e o saldo de pagamento só se aplicam após vincular um responsável. Novos plantões sem valor ficam sem valor definido; o ajuste administrativo de pagamentos baixados continua exigindo autorização e justificativa.
- Aplique `29_sector_finance_and_open_agreements.sql` depois da 28, antes de publicar a interface correspondente. O laboratório `scripts/test-database.ps1` valida a migration e os fluxos em `sector-finance-and-open-agreements.verify.sql` com rollback.

## Modalidade de contratação por plantão

- Aplique `30_shift_employment.sql` depois da 29, em conjunto com a versão correspondente da interface. O vínculo existente `concursado` é exibido como PREFEITURA.
- Os novos acordos e os relatórios de repasses usam apenas plantões PJ. As linhas legadas, inclusive contratações não definidas e valores já registrados, são preservadas.
- Na aprovação de candidaturas e trocas, médico e modalidade são confirmados na mesma transação. Um substituto PJ precisa de um novo acordo. Mudanças incompatíveis em plantões com baixa registrada ficam bloqueadas para regularização financeira.
- A suíte `shift-employment.verify.sql` usa dados sintéticos com rollback para testar as três trocas de modalidade, vagas, permissões e histórico.

## Especialidade principal dos setores

- A migration `31_sector_primary_specialty.sql` acrescenta a especialidade principal sem inferir vínculos nem remover os relacionamentos anteriores. Novos plantões com setor usam essa especialidade; avulsos sem setor mantêm seleção explícita no catálogo autorizado.
- Atribuições, candidaturas e substituições exigem credenciamento aprovado e as autorizações de empresa/unidade/especialidade, com política documental e conflitos validados no servidor. Profissionais legados precisam de aprovação estruturada antes de novas atribuições.
- Mudanças ficam bloqueadas quando existem ocorrências futuras ou em andamento com outra especialidade. Históricos são preservados e as alterações do vínculo são auditadas.
- Aplique após a migration 30, somente com autorização para o ambiente de destino. Execute `scripts/test-database.ps1` para validar os fluxos no laboratório local. O procedimento de vinculação dos setores legados está em [setores-especialidades](../docs/setores-especialidades.md).

## Correção de status cadastral

`53_doctor_status.sql` acrescenta a RPC exclusiva de status e auditoria anterior/novo. É independente de `53_fractional_coverage.sql`; preserve ambas e a migration 54 de nomes já existente. Não cria contas, convites ou alterações de cadastros em lote.

`55_interactive_shift_coverage.sql` acrescenta o salvamento atômico do painel de cobertura. Aplique após `53_fractional_coverage.sql`, antes de promover o frontend interativo. A migration não regrava postos existentes.
