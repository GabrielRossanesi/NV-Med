# Backup e restauração do NV Med

**Parecer de 9 de novembro de 2026 · REPROVADO para a janela de implantação.** O backup de produção foi restaurado e verificado em PostgreSQL 17.11. Os dois objetos privados foram recuperados e conferidos. A recuperação completa ainda depende do ensaio das APIs Supabase Auth e Storage e da aplicação sobre a base recuperada, além de uma cópia recuperável fora do contexto DPAPI atual.

## Ambiente e inventário

| Item | Evidência |
| --- | --- |
| Projeto | NV Med, organização NV Core, referência `racllaysakzbdbjngiby`, produção em São Paulo, plano Free. O painel consultado na auditoria indicou ausência de backup gerenciado do projeto. [Projeto Supabase](https://supabase.com/dashboard/project/racllaysakzbdbjngiby) |
| PostgreSQL | O pooler de sessão autenticou com a credencial DPAPI já configurada. PostgreSQL 17.11, TLS com `sslmode=verify-full` e CA oficial. Consultas em modo somente leitura. O erro anterior `28P01` foi resolvido. [Inventário SQL](../supabase/production-inventory.read-only.sql) |
| Dados | 4 empresas, 3 perfis, 9 médicos, 7 unidades, 7 setores, 25 plantões, 46 registros de documentos e 28 registros de auditoria documental. A exportação inclui os dados e os históricos das tabelas, inclusive as colunas financeiras. |
| Auth | 3 usuários e 3 identidades. O inventário encontrou zero usuários sem perfil, zero perfis sem vínculo com Auth e zero identidades órfãs. A auditoria registrou autenticação por e-mail com SMTP padrão, Site URL `https://med.nvcore.com.br`, os callbacks `/auth/confirm` e `/definir-senha` e cinco redirects legados. |
| Linha de base | O corpo de `public.nv_validate_links()` coincide com o da migration 15 após normalização textual. Os três triggers esperados estão ativos em `doctors`, `medical_documents` e `units`. O marcador da 18 está presente, os sete marcadores checados das 19–25 estão ausentes e a tabela de histórico `supabase_migrations.schema_migrations` não existe. A evidência é de catálogo. |
| Integridade referencial | Três FKs preexistentes no esquema `public` continuam com `NOT VALID`. As consultas de leitura encontraram zero referências órfãs para `documents_doctor_tenant_fk`, `shifts_doctor_tenant_fk` e `shifts_unit_tenant_fk`. |
| Storage | Dois buckets privados. `medical-documents` tem um objeto de 1.000.143 bytes e `profile-avatars` tem um de 394.207 bytes. Entre as referências de documentos atuais, histórico e avatares, houve um caminho distinto referenciado e zero referências ausentes. Não apareceram URLs legadas isoladas nem objetos versionados, arquivados ou marcadores de exclusão no catálogo. |
| Aplicação e configuração | Deploy Vercel `4vSEeXEQiZbGEDEK8asypHmxpNjs`, commit `71c487398cd670b0d2de405d3f97782ea6d8680e`, domínio `med.nvcore.com.br`. A cópia do código corresponde à árvore Git desse commit. Metadados visíveis e nomes e escopos das variáveis foram registrados. [Deploy auditado](https://vercel.com/gabrielrossanesis-projects/nvmed/4vSEeXEQiZbGEDEK8asypHmxpNjs/source) |

O trabalho ficou restrito a leitura do projeto hospedado e gravação em armazenamento e laboratório locais. A coleta não teve pausa operacional de escritas. O `pg_dump` produz um snapshot transacional do banco. O catálogo de Storage foi comparado antes e depois da transferência e os bytes foram comparados com os ETags de origem. Esses controles têm escopos e horários distintos. [Implantação controlada](implantacao-controlada-nv-med.md) · [Auditoria de prontidão](auditoria-prontidao-nv-med.md) · [Roteiro de homologação](homologacao-nv-med.md)

## Artefatos e integridade

A coleta do PostgreSQL começou em **9 de novembro de 2026 às 18h59min41s UTC** e o manifesto foi fechado às **19h00min04s UTC**. Foi usado `pg_dump` 18.6 em formato custom e `pg_dumpall --roles-only --no-role-passwords` 18.6, compatíveis com a leitura do servidor 17.11. O arquivo principal preserva esquema, dados, proprietários, ACLs, índices, constraints, funções, triggers, RLS e metadados de serviços. O catálogo do arquivo confirmou as entradas de dados de `auth.users`, `auth.identities`, `storage.buckets` e `storage.objects`. O dump de papéis preserva definições e vínculos de 15 papéis visíveis, sem senhas de login do PostgreSQL. [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) · [pg_dumpall](https://www.postgresql.org/docs/18/app-pg-dumpall.html)

A coleta dos objetos decorreu de **19h05min51s a 19h05min55s UTC**. O acesso com a chave DPAPI foi validado com listagem por HTTPS e leitura autenticada dos objetos. Os tamanhos e ETags coincidiram com os metadados, e o catálogo permaneceu igual antes e depois. Os caminhos, IDs, versões e hashes do conteúdo constam do manifesto cifrado. [Objetos privados](https://supabase.com/docs/guides/storage/management/download-objects) · [Cobertura dos backups Supabase](https://supabase.com/docs/guides/platform/backups)

Pasta local fora do Git em `C:\Users\gabri\AppData\Local\NVMed-Backups\NVMed-Production-20261109T185904Z`.

| Arquivo | SHA-256 do arquivo cifrado |
| --- | --- |
| `postgres-full.dump.dpapi` | `DA268E1412709D99EF43F7F83C75E024D8081819E2BF0E6D48FE7A8D8C1E8B56` |
| `postgres-roles.sql.dpapi` | `67E3B5AAE0DD236BA2315CC7CACE518D0B9CA8D2C37A09500949BF0E12A67DB8` |
| `postgres-manifest.json.dpapi` | `643C597C90280E451235474047753AB8DCE3A5615F7E1FD6845271955844A065` |
| `postgres-schema.sql.dpapi` | `021028B5FEFB0DC8A0BBE228E0F5D9CEB5E224B9EEE10B03DCF64981C671DF95` |
| `postgres-data.sql.dpapi` | `A6E08CBADF20C5FE0DF573EAC91FA73850D393ACA9293160E17F6269EA2C985A` |
| `storage-object-001.bin.dpapi` | `0C5F4FACA2858F7C6BD5B8AD22872516C439CB3DCC2D98D5C35D2E012C3F753B` |
| `storage-object-002.bin.dpapi` | `2DB53D8699A4A7E3D453B9D9C6E4DA12886330A80C489A2A610E14A80E4A7AE6` |
| `storage-manifest.json.dpapi` | `5B218F460083C4FABAE0EE27B9FD39C80E2FFF10A97F2EA3E9E8161DC4C9664C` |
| `storage-restore-evidence.json.dpapi` | `305C70F3A9F7D220F71495E631EF465ABE9D109C8B846EAE59D386EA5342284C` |
| `postgres-restore-final-evidence.json.dpapi` | `ACA57EA35B21C4CFCED04748E8BF204EBA42E31376AC3492B85B330311E73779` |
| `postgres-restore-catalog-differences.json.dpapi` | `CA24C22778F81C05CEA348FA8DE716EEF2E327E2A4ECF8D3B67CF26BB17B05A8` |
| `integrity-manifest.json.dpapi` | `5DC82A6C84DC35F9CE134FD80F7CCA444FD99292F516C36D5B72083340F13635` |

O PostgreSQL também tem um índice `pg_restore --list`, o inventário SQL e impressões digitais por tabela e por tipo de objeto de catálogo. Os artefatos e seus manifestos foram protegidos com Windows DPAPI em `CurrentUser`. A entropia UTF-8 deste pacote é `NVMed-Production/NVMed-Production-20261109T185904Z/<nome-do-arquivo>`. A verificação compara tamanho e SHA-256 do arquivo cifrado e do conteúdo após descriptografia em memória. A recuperação depende da conta e do contexto DPAPI do Windows usados na coleta. As credenciais `postgres.dpapi` e `storage.dpapi` permanecem na pasta local protegida `Access`, separada dos backups.

As partes de esquema e dados foram extraídas do mesmo arquivo custom, sem nova coleta. A parte de esquema contém as políticas. A parte de dados contém as entradas de usuários, identidades e metadados de Storage. Use o arquivo custom como fonte do replay verificado e as partes SQL como fontes de extração para uma restauração que respeite os esquemas gerenciados pelo Supabase.

O manifesto consolidado inclui a verificação do pacote atual e dos dois artefatos anteriores. O arquivo `SHA256SUMS.txt` lista os hashes dos 22 arquivos cifrados do pacote atual. Seu próprio SHA-256 é `03CABC595F6F8005CFC92B59DB79CF1D0B45FCA945C676DA518CCE54149DB0E3`.

A cópia anterior da aplicação e da configuração visível permanece em `C:\Users\gabri\AppData\Local\NVMed-Backups\NVMed-Production-20261109T182617Z`. A entropia daquele pacote é `NVMed-Production/20261109T182617Z/<nome-do-arquivo>`. O ZIP do commit tem 167 entradas, incluindo o lockfile, que fixa Next.js 16.2.9, React 19.2.4, `@supabase/ssr` 0.12.7 e `@supabase/supabase-js` 2.116.0.

| Arquivo | SHA-256 do arquivo cifrado |
| --- | --- |
| `application-71c4873.zip.dpapi` | `1F5F5069AEC335F7941E475267FB18234BAB82438B336CDAE1CF088EA14BB91D` |
| `operational-config.json.dpapi` | `3E4B3E37F328C2E2171595D46F0F917044D86CD578489E44368823B0B66397A9` |

## Ensaio de recuperação

O arquivo real foi restaurado em um PostgreSQL 17.11 padrão, com binários portáteis da EDB verificados pelo SHA-256 do fornecedor. O cluster foi criado para o NV Med, vinculado a `127.0.0.1` com SCRAM e restrito à conta Windows atual. O laboratório foi encerrado e removido após as conferências. Os arquivos de trabalho do cluster ficaram em uma pasta com ACL restritiva. A criptografia dessa pasta no volume local não foi confirmada. [Binários EDB](https://www.enterprisedb.com/download-postgresql-binaries) · [SHA-256 do pacote](https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip.sha256)

| Verificação | Resultado |
| --- | --- |
| Dados e vínculos | As contagens e impressões digitais das 48 tabelas restauradas coincidiram com o inventário de origem. Foram recuperados os 3 usuários Auth, 3 identidades e 3 perfis. O destino confirmou zero órfãos nos vínculos de Auth e preservou as 3 FKs preexistentes com `NOT VALID`. |
| Catálogo e permissões | O catálogo detalhado teve 445 itens em cada lado. Coincidiram os 15 papéis e vínculos, as ACLs efetivas de tabelas e funções, os grants por coluna e as permissões padrão. O catálogo inclui 194 constraints, 69 funções, 31 triggers e 29 políticas. Entre as 24 diferenças de representação de ACL, 23 eram de ordenação. Em `realtime.schema_migrations`, a ACL explícita da origem tinha apenas os privilégios padrão do proprietário, usados no destino. O único texto de constraint diferente foi o agrupamento de uma expressão `AND` em `medical_documents_type_format`, com as mesmas três condições. |
| Acesso negativo | Uma identidade fictícia sem perfil, executando SQL no papel `authenticated`, obteve zero documentos, plantões e objetos. Esse teste exerceu a RLS no PostgreSQL restaurado. |
| Storage no banco | Os buckets, caminhos, IDs, versões e metadados de objetos restaurados coincidiram com o manifesto dos binários. |
| Vault | A origem tinha zero linhas em `vault.secrets`. A extensão `supabase_vault`, o comentário, a entrada de dados vazia e cinco ACLs de objetos dependentes ficaram fora da lista do ensaio. O arquivo original preserva essas oito entradas. |
| Tempo medido | 0,189 s para restaurar os papéis e 1,993 s para o `pg_restore` do arquivo no segundo ensaio bem-sucedido. Os tempos medem o replay SQL local. |

Os **2 de 2 objetos privados** foram efetivamente recuperados a partir do backup em uma pasta descartável restrita à conta Windows atual. Os caminhos relativos originais, o total de 1.394.350 bytes e os dois SHA-256 coincidiram. O teste levou **0,237 s** para recuperar e verificar os arquivos e a pasta temporária foi removida. O ensaio de arquivos usou o sistema de arquivos local. A carga pela API, o download autorizado e o bloqueio de outra empresa dependem dos serviços Supabase no laboratório.

O ensaio sintético anterior usou dois clusters PostgreSQL 16.15 exclusivos e verificou restauração da linha de base até a 18, fixtures de Auth e Storage, grants e negativa de leitura documental entre empresas. O `pg_restore` sintético levou 0,94 s com os papéis previamente instalados. Essa evidência é distinta da recuperação do backup de produção.

## Pendências para liberar a janela

1. Ensaiar o Supabase Auth e Storage em uma instância local isolada com serviços compatíveis, saída de e-mail desativada e configuração operacional recuperável. Docker e Podman não estavam disponíveis, e o WSL falhou ao enumerar as distribuições. Verificar novo login com conta fictícia, vínculos e permissões, acesso autorizado a documento e avatar, negativa de outra empresa e smoke de escala, financeiro e trilha documental com o build correspondente. Os dados SQL do Auth e os binários estão disponíveis para esse ensaio.
2. Guardar a configuração necessária de Auth, SMTP e Vercel em cofre autorizado e testar a recuperação do conjunto em outro ambiente Windows ou com chave de recuperação independente. Os artefatos DPAPI atuais dependem do contexto local. Os valores protegidos dos serviços e as credenciais de infraestrutura devem ser recuperados pelo cofre.
3. Repetir ou atualizar a coleta após acordar a pausa de escritas e reconciliar PostgreSQL, Auth e Storage. Registrar o ponto comum recuperável, o tempo de recuperação dos serviços e as escritas posteriores que precisariam ser reaplicadas. Os tempos deste relatório medem etapas locais, e o RPO e o RTO completos permanecem pendentes.

## Procedimento de recuperação

1. Verificar a identidade do projeto, os SHA-256 dos arquivos cifrados e os tamanhos antes de descriptografar. Na conta Windows autorizada, usar DPAPI `CurrentUser` e a entropia correspondente. Recalcular o SHA-256 dos conteúdos em memória e conferir os manifestos. Tratar dump, inventário e manifestos como material restrito.
2. Preparar um destino local novo, restrito a loopback, com PostgreSQL 17 e serviços Supabase compatíveis. Usar `pg_restore --list` para selecionar esquema e dados e instalar os papéis de acordo com o destino. Em ambiente Supabase, usar as estruturas gerenciadas provisionadas pelo serviço, separar os papéis e customizações, e restaurar apenas os dados suportados de Auth e os objetos compatíveis. Configurar a aplicação local com chaves do laboratório. [Procedimento de restauração Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
3. Recriar os buckets privados, restaurar os objetos por API de Storage nos caminhos do manifesto e reconciliar as referências com os metadados recriados pelo serviço. Verificar contagens, constraints, funções, triggers, políticas, grants, hashes e permissões com contas fictícias. Restabelecer a versão compatível da aplicação e executar os testes funcionais antes de reabrir escritas.
4. Em falha na janela, registrar o último `COMMIT`, o deploy ativo e as escritas posteriores ao backup. Confirmar o rollback da transação que falhou e a compatibilidade do estado parcial. Se for necessária restauração, preservar as escritas posteriores e recuperar PostgreSQL, Auth, Storage e aplicação de forma coordenada. O rollback da Vercel atua na versão servida. A recuperação do banco e dos arquivos segue os passos próprios. [Plano da janela](implantacao-controlada-nv-med.md) · [Rollback de deploy da Vercel](https://vercel.com/docs/instant-rollback)
