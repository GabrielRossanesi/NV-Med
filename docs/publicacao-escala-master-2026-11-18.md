# Publicação da Escala Master — 18/11/2026

Disponível em [med.nvcore.com.br/escala](https://med.nvcore.com.br/escala). Selecione unidade e setor e alterne para **Escala Master**. Não foram cadastradas regras, ausências nem plantões de teste em produção.

## Versão

- Código: commit `824a60e43a6999c28040fb6a1d7e65d683362016`, enviado à branch `codex/redesign-visualizacao-escalas`.
- Deploy de produção: `dpl_7vCvKwvWYKHx9uvHJ8Y9RjvNDViQ`, estado **Ready**, promovido para o domínio principal.
- [Inspeção do deploy](https://vercel.com/gabrielrossanesis-projects/nvmed/7vCvKwvWYKHx9uvHJ8Y9RjvNDViQ).
- Deploy anterior preservado: `dpl_AxYZXLZxZ7fbqYiS4QmwX2AjmJsA`.
- Os arquivos da versão de perfil médico já publicada foram conferidos pelo manifesto local da publicação anterior. A nova versão mantém essas funcionalidades.
- Pacote Vercel conferido antes do upload: 264 arquivos; excluídos Import, backups, chaves, ambiente local, Git e rotas temporárias de laboratório.

## Banco e Cron

A migration `37_master_schedule.sql` foi aplicada após confirmação da 36 no projeto Supabase existente `racllaysakzbdbjngiby`, PostgreSQL 17.11. SHA-256: `48f59e2bf4a867ca8bd421d239c08359c6217260142f1642f94cc382dcdb1159`.

A migration e a instalação/configuração do pg_cron foram executadas em uma única transação, com espera limitada por locks e comparação de contagens/assinaturas de **33 tabelas preexistentes**, incluindo usuários/identidades Auth e metadados do Storage. Uma divergência provocaria rollback. A comparação passou; as políticas RLS existentes permaneceram iguais.

| Verificação | Resultado após publicação |
| --- | ---: |
| Médicos | 92 |
| Plantões | 947 |
| Documentos | 1.350 |
| Usuários Auth | 13 |
| Regras Master | 0 |
| Ausências | 0 |
| Ocorrências Master | 0 |

As oito novas tabelas têm RLS e nenhum acesso direto para anon/authenticated. O worker não é executável por esses papéis; seu acesso está disponível ao service_role e ao proprietário utilizado pelo Cron. O schema privado não é acessível ao cliente. A atualização do cache de schema do PostgREST foi solicitada ao concluir a transação.

O job **`nvmed-master-daily`**, ID 1, está ativo com `0 5 * * *`, executando `SELECT public.nv_master_generate_scheduled();` no banco postgres. O fuso efetivo do Cron foi confirmado como GMT: execução diária às **02h de Brasília**. O worker foi chamado com as tabelas ainda vazias em uma transação revertida e retornou `{"rules":0}` sem erro. A primeira execução automática futura ainda não foi observada; acompanhar `cron.job_run_details` após o horário programado.

## Validação

- Antes da publicação: 127 testes de aplicação, suíte SQL local até a 37, TypeScript, lint e build local aprovados. Build Production aprovado na Vercel antes da promoção.
- Domínio principal inspecionado depois da promoção: associado ao novo deploy em Ready.
- `/login` e `/portal`: HTTP 200. `/escala` e `/medicos` sem sessão: HTTP 307 para login. `/api/health` sem sessão: HTTP 401.
- Uma sessão administrativa já existente abriu a página oficial, selecionou unidade/setor e consultou a Master. O seletor Geral/Master, cadastro de fixo, gestão de ausências e histórico apareceram; a consulta autenticada retornou vazia sem erro e sem aviso de Cron desabilitado.
- Foram feitas apenas navegação, leitura e configuração de infraestrutura autorizada. Nenhuma regra ou ausência foi aplicada pela interface, nenhum convite foi enviado e nenhuma atribuição, confirmação, presença ou pagamento foi modificado.

## Backup e evidências

A revisão automática de aprovação bloqueou a criação de um **novo dump completo**, por exportar dados sensíveis de produção. A exportação não foi executada e não houve tentativa por outro método. O backup criptografado verificado da publicação anterior, de 18/11/2026 às 16:37 UTC, permanece preservado. Esta atualização aditiva usou as verificações transacionais de preservação descritas acima; não há alegação de backup novo para a 37.

Evidências agregadas e scripts de implantação estão em `Import/_master-release-20261118`, fora do Git e do pacote Vercel. O [guia operacional](escala-master-e-afastamentos.md) descreve uso, permissões, proteção de históricos e limitações da validação. Para voltar à interface anterior, promover o deploy anterior; a migration aditiva pode permanecer instalada, sem remover tabelas nem dados históricos.
