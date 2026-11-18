# Vínculos provisórios das escalas importadas

A migration 35 permite registrar, mediante autorização explícita da administração,
o médico identificado na escala original mesmo quando seu cadastro ou
credenciamento está pendente. O profissional permanece pendente e o plantão fica
aguardando confirmação.

As exceções ficam em `import_assignment_authorizations`, sem acesso por `anon`,
`authenticated` ou `service_role`. Somente a execução privilegiada da importação
pode provisioná-las. A tabela tem RLS habilitada e não altera as políticas das
tabelas existentes.

Cada autorização vincula exatamente um posto existente a um médico e conserva
empresa, unidade, setor, especialidade, data, início, fim e contratação da fonte.
Também registra o hash do PDF, a base de identificação, a justificativa e a
possibilidade de revogação. Alterar esses campos não transfere a exceção para
outro posto ou profissional.

As validações preservam isolamento entre empresas, unidade e setor ativos,
especialidade, ausência de sobreposição e bloqueio documental configurado.
A exceção permite vínculo pendente e cancelamento. Confirmação e conclusão exigem
credenciamento regular. Nenhum cadastro é ativado, dado obrigatório é preenchido,
documento é aprovado, usuário Auth é criado ou pagamento é gerado pela exceção.

A tela de escalas consulta os médicos da empresa para apresentar o responsável
registrado, inclusive pendente. A seleção de novos responsáveis continua usando
o RPC de elegibilidade existente; o médico já registrado é preservado ao abrir
sua ficha.

Validação: `provisional-import-assignments.verify.sql`, incluída na suíte SQL até
a migration 35, testa escopo, revogação, acesso negado à tabela, cadastro
inalterado, plantão avulso, conflito de horário, tentativa de confirmação,
alteração de contratação, cancelamento e liberação do vínculo. Os dados de teste
são sintéticos e a transação é revertida.

As fontes, prévias, backups e o rollback dos vínculos reais ficam na área local
privada da execução, excluída do Git e da publicação da Vercel.
