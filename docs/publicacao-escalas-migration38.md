# Publicação das escalas e migration 38

Publicação autorizada e concluída em **18 de novembro de 2026** no domínio [med.nvcore.com.br](https://med.nvcore.com.br).

## Versão publicada

- Commit da aplicação: `3f5ed0807b27c703758c62c45226e92c7a7ac35b`.
- Branch: `codex/redesign-visualizacao-escalas`.
- Projeto Vercel: `nvmed`, ambiente Production.
- Deploy: `dpl_7VD96GDi4aJVhSj3X77272grv3x5`.
- [Inspeção do deploy](https://vercel.com/gabrielrossanesis-projects/nvmed/7VD96GDi4aJVhSj3X77272grv3x5).
- O build foi preparado sem promover o domínio, aguardou o estado Ready e foi promovido após a aplicação e pós-verificação do banco. A API de aliases confirmou que `med.nvcore.com.br` aponta para esse ID; os metadados do deploy confirmaram o commit acima.

A versão inclui filtro multissetorial, correção do filtro exclusivo de vagas disponíveis, calendários mensal/semanal/diário com cartões compartilhados, melhoria dos nomes, cadeado por aba e auditoria administrativa. Médico e Coordenador Médico permanecem no Portal, sem escrita direta administrativa nem acesso ao histórico administrativo. Os detalhes funcionais estão nos guias de [filtros e calendários](correcao-filtros-calendario-escalas.md) e [bloqueio e auditoria](filtros-bloqueio-e-auditoria-escalas.md).

## Banco de produção

- Supabase NV Med: `racllaysakzbdbjngiby`, PostgreSQL 17.11.
- Aplicada uma única vez a migration `38_schedule_controls_and_audit.sql`, após confirmar a presença da 37 e a ausência dos marcadores da 38.
- SHA-256 do arquivo aplicado: `1A7B6FCEF1D090BF472DDC90FC936F73DED2A51B90D4ACC5F482D423EF8F84BA`.
- A aplicação usou transação única, limite de espera por locks de cinco segundos e comparação de contagens e assinaturas das colunas existentes em **42 tabelas**. Os dados existentes, as definições das políticas RLS e a identidade/configuração do Cron permaneceram iguais.
- Contagens preservadas: **92 médicos, 947 plantões, 1.350 documentos e 13 usuários Auth**. Permaneceram zero regras da Master e zero afastamentos. Não foram criados testes, atribuições ou confirmações na produção.
- Confirmados os novos RPCs de histórico/disponibilidade, oito colunas adicionais de auditoria e seis gatilhos de auditoria. O histórico permanece sem acesso direto pelos clientes e o schema privado segue inacessível a eles.
- A matriz efetiva do banco negou visualização administrativa, edição, criação, exclusão, aprovação e histórico aos perfis Médico/Coordenador Médico, inclusive com concessões genéricas. Diretor manteve edição e Gerente manteve histórico conforme as permissões previstas.

Duas tentativas preliminares foram integralmente revertidas pelos controles adicionais, antes do commit SQL. A primeira encontrou a restrição do Supabase ao lock da tabela gerenciada do Cron; sua verificação passou a usar leitura e comparação. A segunda identificou que a checagem adicional precisava preservar a permissão de execução de `service_role` já definida pela 37. A migration versionada não precisou mudar por esses ajustes de verificação.

O backup criptografado anterior foi preservado e seu hash foi conferido. Não houve nova exportação de dados reais. Os arquivos locais de operação/evidência continuam em `Import`, excluídos do Git e do envio à Vercel.

## Cron preservado

O job `nvmed-master-daily`, ID 1, continua ativo, com `0 5 * * *` (02:00 em São Paulo), executando `SELECT public.nv_master_generate_scheduled();`. Usuários autenticados e anônimos continuam sem permissão para executar o trabalhador. A permissão de serviço existente foi preservada. O trabalhador não foi acionado para teste durante esta publicação.

## Verificação

- **137 testes automatizados aprovados**.
- Laboratório PostgreSQL descartável: baseline 01–18, migrations 19–38, permissões, disponibilidade de vagas, privacidade, candidaturas/trocas e regressão da Master aprovados.
- TypeScript e lint dos arquivos alterados aprovados. Build de produção na Vercel concluído com estado Ready.
- O manifesto enviado à Vercel não continha arquivos de `Import`, credenciais locais, backups, dependências locais, diretórios de build ou rotas temporárias de QA.
- No domínio principal: `/login` e `/portal` responderam 200; `/escala` e `/escala/candidaturas` redirecionaram ao login sem sessão; `/api/health` respondeu 401 sem autenticação.

Os testes visuais dos calendários e perfis foram realizados com componentes reais e dados fictícios locais. A validação autenticada da experiência publicada fica para o usuário, sem impersonar contas ou modificar escalas reais para a conferência. A disponibilidade exibida de mudanças feitas em outra sessão depende da próxima atualização periódica, de até um minuto, ou da recarga da página.
