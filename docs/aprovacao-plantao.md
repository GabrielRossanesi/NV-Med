# Aprovação de plantões e edição retroativa

A migration `48_shift_approval.sql` acrescenta a origem e a revisão da confirmação à ficha do plantão. A autenticação do médico é verificada no Portal Médico. A aprovação administrativa registra o colaborador e exige justificativa. Um médico credenciado pode ser aprovado antes de receber acesso ao Portal Médico. Candidaturas e substituições selecionadas pela coordenação registram a decisão administrativa no histórico.

O campo de aprovação é controlado pelo banco. Plantões legados com situação confirmada ou concluída recebem a classificação conservadora ao consultar ou editar, preservando a origem desconhecida. Os eventos de aprovação, invalidação e edição retroativa ficam em **Histórico administrativo de escalas**. Observações privadas continuam restritas à ficha do plantão. Alterações monetárias usam o histórico financeiro protegido.

Depois do encerramento, a confirmação expressa do médico e a classificação legada protegem a operação. Para os demais casos, a edição exige `escala.edit`, `escala.edit_past` e justificativa. O cadastro mantém os fluxos de presença existentes. Os cargos de operação recebem as ações `escala.approve_shift` e `escala.edit_past` conforme os padrões de cada perfil e as exceções configuradas.

A data de encerramento é calculada no servidor com o fuso IANA gravado no plantão. Novos registros usam `units.time_zone`. Os registros existentes preservam `America/Sao_Paulo`, o fuso anteriormente usado pelo sistema. Uma mudança de unidade atualiza o fuso do plantão. Alterar apenas a configuração da unidade preserva a interpretação dos plantões existentes.

## Homologação e ativação

1. Use um banco descartável e aplique os scripts numerados na ordem. Execute `shift-approval.verify.sql` após a 52.
2. No ambiente autorizado, confira a versão das migrations, faça backup e conte os pendentes antigos por unidade antes de ativar a rotina. Verifique as unidades que operam com outro fuso e regularize os cadastros antes de criar novos plantões.
3. Aplique a migration 48 e disponibilize a aplicação correspondente na mesma janela. Verifique uma aprovação por tipo e a proteção das edições em homologação.
4. Aplique a migration 52 e execute `shift-approval-cron.setup.sql` como proprietário do banco. O setup grava a hora da primeira ativação no banco. O job só considera encerramentos posteriores a esse corte. O job usa o mesmo pg_cron da Escala Master e processa até 200 registros a cada cinco minutos. A aprovação usa o horário do servidor e um bloqueio por linha. Reexecutar o setup mantém o corte original. Reexecutar o job preserva aprovações existentes.
5. Confira o histórico do job e a evolução do volume de pendentes. Se precisar suspender a rotina, desative o job nomeado `nvmed-shift-approval`. Os eventos já registrados permanecem auditáveis.
