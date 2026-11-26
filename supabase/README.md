# Banco de dados do NV Med

A correção de status cadastral utiliza `53_doctor_status.sql` após a 52. Ela grava apenas o status, preserva as validações existentes e registra estado anterior/novo na auditoria. Não aplicar em produção nem publicar sem autorização. Consulte o [diagnóstico e padrão de confirmações](../docs/correcao-status-medicos.md).

## Provisionamento seguro

1. Em um projeto vazio, aplique os scripts numerados na ordem `01 → 02 → 04 → 05 → 06 → 08–47`. A etapa 01 cria as tabelas iniciais com RLS e acesso fechado aos clientes. A 04 cria `medical-documents` privado. Mantenha a aplicação fechada durante a instalação.
2. Em um projeto existente com as migrations até a 45, aplique `46_secure_provisioning.sql` para remover concessões e políticas legadas. A migration preserva os objetos armazenados. Aplique a 47 com a versão de Minha conta, depois de conferir o histórico do ambiente.
3. Execute [a verificação de provisionamento](provisioning.verify.sql) antes de importar dados reais, carregar arquivos ou abrir a aplicação. Ela consulta o catálogo e interrompe a validação quando faltam controles, os buckets médicos ou de avatar estão públicos, há políticas anônimas em `public` ou `storage.objects`, ou `anon` tem permissões nos objetos da aplicação. Investigue a condição identificada e repita a verificação até obter `PASS`.
4. Use `07_bootstrap_admin.sql` separadamente, se precisar vincular o primeiro administrador já cadastrado no Auth. A carga `03_seed.sql` contém dados de demonstração para laboratório. O antigo `init_all.sql` foi desativado e retorna um erro com este roteiro.

O laboratório PostgreSQL em `scripts/test-database.ps1` reconstitui a instalação e testa a verificação com concessão anônima, bucket público e endurecimento incompleto.

Para adiar a varredura antimalware, aplique `40 → 41 → 42 → 43 → 45 → 46` e publique a aplicação correspondente na mesma janela. Os buckets continuam privados, e a rota exige vínculo e autorização em cada acesso. A análise antimalware permanece pendente até a migration 44. Para verificar esse estado, execute `SET nvmed.verify_deferred_document_scan = 'on';` seguido de `provisioning.verify.sql` na mesma sessão SQL. O laboratório aceita `-DeferDocumentScan` para testar essa sequência e a ativação posterior da 44.

`43_doctor_data_minimization.sql` mantém apenas colunas profissionais na leitura direta de `doctors`. A ficha individual libera CPF, nascimento, endereço e contatos para o próprio médico e para quem tem permissão de aprovar credenciamento. A gestão do Portal Médico usa seu recorte próprio de e-mail e último acesso. A versão da aplicação com a projeção explícita precisa estar no ambiente quando a permissão de coluna mudar.

`44_medical_document_quarantine.sql` exige análise limpa da versão atual do objeto antes de emitir uma URL de acesso ou aprovar um novo arquivo. O bloqueio também se aplica a originais importados e versões históricas. Durante a transição, URLs emitidas pela versão anterior expiram pelo TTL já existente. Mantenha uploads e importações com caminhos imutáveis e nomes novos a cada versão.

Se a 44 foi adiada, aplique-a uma única vez quando o scanner estiver pronto. A rota passa a exigir o resultado automaticamente. Processe o acervo e execute `provisioning.verify.sql` em uma nova sessão antes de reabrir o acesso.

O processo `node scripts/scan-medical-documents.mjs 50` usa `NVMED_SCAN_SUPABASE_URL`, `NVMED_SCAN_SERVICE_ROLE_KEY` e, quando configurado, `NVMED_CLAMD_SOCKET`. Sem esse último, o processo usa o `clamd` local em `127.0.0.1:3310`. Execute o scanner em infraestrutura controlada, com assinaturas atualizadas, `StreamMaxLength` de pelo menos `25M` e alertas para conteúdo criptografado e limites excedidos. Processe o acervo em lotes e execute periodicamente no ambiente autorizado. Falhas mantêm o bloqueio e voltam à fila após o intervalo de reprocessamento. O processo registra apenas totais. [Protocolo do ClamAV](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)

`45_resumable_organization_cleanup.sql` registra a fila antes do expurgo relacional e reconcilia o Storage e o Auth depois de cada tentativa. O CEO com MFA retoma pela lista **Exclusões pendentes**. Identidades vinculadas a outra empresa e autores necessários para históricos retidos são preservados. `settings.retention_hold` impede o expurgo, assim como histórico de plantões. Para esses casos, a operação retorna um impedimento e preserva os registros. A publicação das três migrations deve ser coordenada com a aplicação atualizada.

`41_administrative_mfa.sql` exige uma sessão AAL2 ativa em gestão de contas, troca administrativa de senha, acesso ao Portal Médico, alteração de cargo médico e exclusão de empresa. As contas com essas atribuições cadastram e confirmam o TOTP em **Minha conta → Segurança**. Valide cadastro, confirmação e uso de um autenticador reserva em homologação. Coordene a migration com as rotas e a interface correspondentes. As operações protegidas recusam versões incompatíveis durante a transição.

`47_staff_account.sql` cria as preferências pessoais, o histórico da conta e a regra que preserva o último TOTP de um perfil interno ativo. A configuração de auditoria do Auth e os limites de recuperação e sessões estão no [guia de Minha conta](../docs/minha-conta.md).

`42_attendance_confirmation.sql` envia novos check-outs por GPS para **Escala → Candidaturas → Revisar registros de presença**. A coordenação confere o registro com uma fonte independente da unidade e descreve a fonte na justificativa. O solicitante não pode revisar o próprio registro. Enquanto o check-out estiver pendente ou rejeitado, o banco bloqueia a conclusão e a baixa do plantão. O check-in mantém caráter declaratório, e registros históricos preservam os estados existentes. Aplique a 42 após a 41, junto da interface de revisão atualizada.

`40_doctor_credential_writes.sql` restringe a escrita direta de vínculos e especialidade. Aplique após a 39, depois de disponibilizar a versão da aplicação que envia apenas os campos de contrato pela escrita direta. As RPCs existentes mantêm a edição validada do perfil e a aprovação de vínculos. A migration ajusta as permissões, sem regravar cadastros.

`39_schedule_audit_context.sql` reutiliza o histórico e o estágio privados da 38 para correlação transacional, contexto histórico de unidades e importações privilegiadas. Aplique após a 38. [Guia dos complementos](../docs/complementos-controle-auditoria-escalas.md)

Filtros e controle administrativo das escalas: aplicar `38_schedule_controls_and_audit.sql` após a 37 e antes da interface correspondente. Reforça a autorização usada por RLS/RPCs e amplia o histórico existente, sem modificar escalas reais nem reagendar o Cron. [Guia de filtros, bloqueio e auditoria](../docs/filtros-bloqueio-e-auditoria-escalas.md)

Escala Master e afastamentos: aplicar `37_master_schedule.sql` após a 36 e configurar `master-schedule-cron.setup.sql` para geração diária. Não converte escalas importadas. O [guia de recorrências e ausências](../docs/escala-master-e-afastamentos.md) descreve permissões, prévia obrigatória, contratos, laboratório e ativação.

Perfil médico e acesso individual ao portal: aplicar `36_doctor_profile_access.sql` após a 35 e antes da interface correspondente. Não cria contas nem envia convites em lote. O [guia de perfil e acesso](../docs/perfil-medico-acesso-portal.md) descreve inventário somente leitura, separação de credenciamento/Auth, permissões, SMTP e testes.

Os dados bancários médicos usam a migration incremental `32_doctor_banking.sql`, após a 31. Aplique em conjunto com a versão correspondente da interface e com autorização para o destino. O [guia de dados bancários](../docs/dados-bancarios-medicos.md) descreve migração dos valores legados, permissões, proteção e testes locais.

O piloto interno no Supabase existente segue o [plano de implantação controlada](../docs/implantacao-controlada-nv-med.md). O [roteiro de laboratório isolado](../docs/homologacao-nv-med.md) registra os testes locais e a estratégia anterior.

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

## Evolução já publicada

Após a 51, preserve a ordem de dependências: 52_shift_approval_activation_cutoff.sql, 53_fractional_coverage.sql, 54_doctor_name_normalization.sql e 55_interactive_shift_coverage.sql. O arquivo 53_doctor_status.sql é independente de 53_fractional_coverage.sql; ambos são necessários. A antiga cópia local 52_fractional_coverage.sql foi consolidada no nome 53_fractional_coverage.sql, sem alterar seu conteúdo. Não reaplique migrations já presentes no ambiente.

A 55 acrescenta o salvamento atômico do painel interativo de cobertura, reaproveita as validações existentes e não regrava postos legados. Consulte o guia de cobertura fracionada. A quarentena documental (44) continua opcionalmente adiada até a preparação do scanner, conforme a seção de provisionamento seguro.
