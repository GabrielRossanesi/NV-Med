# Escala Master, Escala Geral e ausências

Implementação local de 18/11/2026. A Master gera registros na tabela operacional `shifts`; a Escala Geral, Portal Médico, presença, candidaturas e financeiro continuam usando os plantões existentes. Nenhuma escala importada é convertida automaticamente em recorrência.

## Uso

1. Em Escalas, escolha Unidade e Setor. A visualização inicial continua sendo a Escala Geral. Alterne para Master mantendo os filtros.
2. Cadastre o médico fixo credenciado, horários, dias, datas, referência, modalidade e horizonte de 1 a 12 meses futuros. Semanal, quinzenal e N semanas usam a semana de segunda a domingo da referência; mensal usa a posição ordinal do dia da referência para cada dia da semana escolhido. A quinta ocorrência é pulada nos meses que não a possuem.
3. A gravação gera os plantões futuros até o fim do mês do horizonte. O botão Gerar e conferir atua apenas na unidade/setor selecionados. Cada atribuição nova fica pendente de confirmação.
4. Registre uma ausência pela Master ou pelo perfil do médico. Consulte a prévia e confirme explicitamente. Qualquer alteração nos plantões ou na ausência invalida a prévia anterior. Horários parciais se repetem diariamente e podem atravessar a meia-noite.
5. Os postos ficam pendentes de cobertura. Abra o plantão para designar um substituto pelo formulário existente ou publique a vaga para candidaturas. Publicar é uma decisão separada de abrir cobertura; vagas não publicadas ficam ocultas das ofertas do portal e rejeitam candidatura por RPC.
6. No cancelamento/edição de ausência, restaure apenas postos vazios, futuros e sem impedimentos. Substitutos, alterações manuais, presença e baixas financeiras ficam preservados. O resultado informa quantos registros exigem revisão.

O Portal Médico permite consultar somente as próprias ausências e os plantões afetados. Não há solicitação de ausência que altere a escala automaticamente. Observações privadas ficam restritas à gestão autorizada e ao próprio médico; a grade, origem do plantão e notificações de cobertura não apresentam motivo nem tipo de afastamento.

## Regras e integrações

- Regras têm versões com início de vigência. A ficha do plantão edita apenas aquela ocorrência; os atalhos de origem permitem editar esta e as próximas ou a regra completa a partir de hoje/última revisão futura. O médico da regra não é trocado: encerre a antiga e crie outra.
- Ajustes manuais e exclusões explícitas criam exceções permanentes para aquela data. Regenerar não desfaz substituições nem recria exclusões. Confirmar um plantão, registrar presença ou pagamento não cria outra escala.
- Alterar/suspender/encerrar permite preservar os plantões já gerados ou liberar ocorrências futuras sem ajustes. Postos criados pela regra são cancelados, sem apagar histórico; postos reaproveitados são desocupados. Coberturas, oportunidades já abertas, presença e pagamentos ficam protegidos.
- Postos reutilizados precisam coincidir em empresa, unidade, setor, data, horário, especialidade, modalidade e valores compatíveis. Não são adotadas atribuições antigas ocupadas, postos com histórico de candidatos ou de atribuição, nem plantões avulsos. A capacidade diária/noturna do setor é respeitada.
- Quando já existe uma atribuição idêntica ocupada, a data da regra fica bloqueada para revisão da vigência, sem criar outro posto nem converter o registro existente. Conflitos em outra unidade/setor podem gerar cobertura vazia no posto da regra.
- A geração usa chave única por regra/data, locks por médico/regra/posto e os validadores existentes de credenciamento, documentos e conflito, incluindo identidade entre empresas. Impedimentos do médico originam cobertura vazia; falhas de validação ficam sinalizadas para revisão.
- CLT e Prefeitura não criam repasses. PJ exige autorização financeira e um acordo aprovado pelas mesmas funções existentes. O trabalhador diário utiliza uma cópia privada desse acordo e calcula o vencimento pelas condições atuais da empresa; não cria pagamentos nem impersona usuários. Alterar uma regra PJ requer nova confirmação do acordo.
- Notas e acordos ajustados manualmente também tornam a ocorrência uma exceção. A proteção de escala preserva data/horário/responsável consolidados, mantendo disponível o fluxo financeiro existente de correção administrativa autorizada do valor combinado, sem reabrir nem alterar o valor efetivamente pago.
- A autorização do autor da versão é verificada antes de cada nova geração. Revogação de acesso ou exigência de redefinição de senha bloqueia novas ocorrências até uma revisão autorizada. Plantões já gerados não são apagados.
- Mudanças de médico seguem os formulários e aprovações existentes, inclusive exigência de novo acordo PJ. O gatilho de indisponibilidade também protege alterações diretas, confirmações e candidaturas.
- Alterações da Master recarregam a visão operacional e a consulta da Master. O calendário não faz consultas por célula; a origem é consultada em lote somente no painel/ficha.

## Migração e ativação

1. Conferir o ambiente de destino e o inventário somente leitura em `supabase/master-schedule.preflight.sql`. A validação local não inspeciona nem modifica dados reais. Verificar a implantação das migrations 33–36 e o credenciamento dos médicos que serão cadastrados como fixos.
2. Aplicar **37_master_schedule.sql após a 36**, junto da interface correspondente. É uma migração aditiva, transacional e com limite de espera por locks. Não contém carga de regras/ausências reais, conversão ou exclusão de dados históricos. Não reaplicar a migração inteira sobre um esquema já atualizado.
3. As novas tabelas têm RLS e nenhum acesso direto para anon/authenticated/service_role. RPCs verificam empresa, sessão e permissões; helpers, versões financeiras e capacidade interna de escrita ficam privados. Gestão de ausências/publicação exige edição **e** aprovação em Escalas; PJ exige edição financeira. Visualização segue acesso a Escalas, com valores mascarados para quem não pode ler Financeiro.
4. Habilitar Supabase Cron e executar **master-schedule-cron.setup.sql** como proprietário do banco. O job nomeado `nvmed-master-daily` executa às 05:00 UTC (02:00 São Paulo) e atualiza a programação existente. Se `pg_cron` já estiver instalado, a migration agenda o job; caso contrário, a interface avisa que a geração diária está pendente.
5. Cadastrar uma regra validada e conferir geração, ausência, cobertura e financeiro antes de ampliar o uso. A criação de regra gera plantões reais; não usar a suíte sintética no projeto de produção.
6. Monitorar `cron.job_run_details`, o histórico da Master e ocorrências bloqueadas. Banco pausado ou job desativado interrompe a geração: ao retomar, executar Gerar e conferir; o sistema completa o horizonte a partir de hoje, sem criar plantões passados. O agendamento usa SQL no banco, sem serviço pago adicional; disponibilidade/limites do plano do projeto continuam aplicáveis.

Referências oficiais: [Supabase Cron](https://supabase.com/docs/guides/cron), [instalação do Cron](https://supabase.com/docs/guides/cron/install) e [segurança de funções](https://supabase.com/docs/guides/database/functions).

## Validação

- `npm test`: 127 testes, incluindo calendários, recorrência semanal/quinzenal/N semanas, múltiplos dias, quinta ocorrência mensal, virada do ano, horários parciais/noturnos e interface por permissão.
- `scripts/test-database.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\16\bin'`: laboratório descartável, baseline 01–18 e migrations 19–37, com as suítes existentes e `master-schedule.verify.sql`. Nenhuma conexão de produção.
- SQL da Master: idempotência, reutilização de posto, ausência antes/depois da geração, prévia obsoleta e confirmação obrigatória, edição/cancelamento com substituto preservado, ausência parcial/noturna, publicação/retirada de oferta e candidatura real pelo RPC existente, bloqueio de atribuição a afastado, geração PJ sem JWT, pagamento protegido, revisão futura, origem histórica, exceções manuais/exclusões, isolamento entre empresas, privacidade do portal e máscara financeira.
- `tsc --noEmit`, lint dos arquivos afetados e build local com credenciais Supabase removidas.
- Inspeção de componentes reais em navegador com RPC fictícia local: desktop, viewport de 390 px, criação de regra, prévia/confirmar ausência, publicação de cobertura e acesso de leitura. As RPCs/banco foram testadas separadamente no PostgreSQL real do laboratório; não foi feita homologação com contas reais nem envio real de notificações, e-mail ou pagamentos.

Os testes não provam os limites de tempo de um volume real de produção nem simulam duas transações concorrentes. Há locks, chave única e revisão otimista para esse controle; medir a primeira execução agendada e manter o horizonte compatível com a operação. O indicador de Cron habilitado verifica a configuração do job, não seu último sucesso.
