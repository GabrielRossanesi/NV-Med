# Faturamento empresarial

A migration `50_company_billing.sql` inclui contratantes, contratos e regras horárias. A regra vigente é escolhida, na ordem, pelo setor, unidade, especialidade, tipo de plantão, turno e classe de dia. Períodos sobrepostos no mesmo recorte são recusados, inclusive entre contratos diferentes, pois a escala existente não tem seleção manual de contrato. Para feriados, o cálculo usa o calendário financeiro definido para a empresa. Turno e classe de dia se aplicam à data e ao início do plantão, inclusive quando termina no dia seguinte.

Novos plantões recebem os valores previstos da regra aplicável. Alterar a tabela de preços preserva os registros já calculados. Uma mudança operacional no recorte do plantão pode exigir outra regra. O custo calculado para o serviço e o acordo de pagamento PJ ficam disponíveis nas áreas correspondentes. O acordo legado se mantém como obrigação de contas a pagar.

A apuração informa minutos realizados, remuneráveis e faturáveis e exige uma referência na justificativa. O sistema converte minutos em horas e arredonda o subtotal de cada plantão a dois centavos decimais no banco. Regras tarifárias têm quatro casas decimais. Horas realizadas ficam indefinidas até apuração. Para um plantão histórico sem snapshot, um usuário financeiro confirma a regra vigente antes de regularizar.

A consolidação reúne plantões apurados por competência, contrato, unidade e setor. O identificador do plantão é único nas linhas de faturamento. Depois de registrar a data e referência do documento já emitido, a ficha aceita repasses parciais, descontos, glosas, ajustes e estornos. O fechamento exige faturamento emitido para os plantões alocados da competência. A reabertura exige permissão e justificativa. Plantões já consolidados permanecem protegidos e o ajuste registra uma nova movimentação.

O acesso direto às tabelas fica bloqueado para clientes. As funções autenticadas validam empresa e ação antes de ler ou gravar. Os perfis de Direção, Gerência e Financeiro recebem os acessos correspondentes, com regras próprias para ajuste e reabertura. A distribuição pode ser revisada nas permissões da empresa.

Em homologação, aplique depois da migration 49 e execute `company-billing.verify.sql` em um banco descartável. Cadastre a contratante, o contrato e a vigência para um setor de teste. Confira apuração, emissão, repasse parcial, glosa, fechamento e reabertura pelo painel.
