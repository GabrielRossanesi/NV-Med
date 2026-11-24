# Pagamentos de plantões

A migration `49_shift_cash_payments.sql` mantém a obrigação no acordo financeiro do plantão. Cada transferência ou estorno tem um identificador próprio e ocupa uma linha imutável. O saldo desconta o total efetivamente pago. Um pagamento parcial pode ser complementado pela ficha financeira. O estorno referencia a movimentação original e exige justificativa.

Na escala, o vencimento à vista continua no acordo do plantão, em **Modalidade de pagamento**. A opção **Plantão pago à vista** abre os campos de baixa efetiva. Para um plantão individual, o acordo e a baixa são gravados na mesma transação. O usuário precisa de edição em Financeiro. O estorno também exige edição em Configurações. A presença e as restrições de check-out pendente continuam sob as regras existentes.

O bucket privado `finance-receipts` usa o Storage do projeto e aceita PDF, JPG e PNG de até 10 MB. A gravação do banco referencia um arquivo existente com o mesmo identificador da operação. O envio de arquivo acontece antes da transação SQL. Um envio bem-sucedido seguido de uma falha permanente na gravação pode deixar um arquivo sem vínculo. Audite arquivos sem vínculo em homologação antes de autorizar a limpeza.

Valores legados continuam na obrigação. Pagamentos novos registram data, valor e forma separadamente. Estornos nesta interface referenciam transferências registradas pelo novo fluxo. O histórico anterior permanece disponível na ficha.

Valide `shift-cash-payment.verify.sql` após a migration 49 em um banco descartável. Em homologação, confira o acesso ao bucket e a resposta da interface ao repetir um envio ou registrar um pagamento parcial.
