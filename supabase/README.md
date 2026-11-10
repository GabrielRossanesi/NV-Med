# Banco de dados do NV Med

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
