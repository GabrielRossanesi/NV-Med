# Publicação do perfil médico e acesso individual — 18/11/2026

A migration `36_doctor_profile_access.sql` foi aplicada ao Supabase NV Med existente (`racllaysakzbdbjngiby`, PostgreSQL 17.11). A versão da aplicação foi publicada no projeto Vercel `nvmed` e promovida para [med.nvcore.com.br](https://med.nvcore.com.br).

## Identificação

- Deploy promovido: `dpl_AxYZXLZxZ7fbqYiS4QmwX2AjmJsA`.
- [Inspeção Vercel](https://vercel.com/gabrielrossanesis-projects/nvmed/AxYZXLZxZ7fbqYiS4QmwX2AjmJsA).
- Deploy anterior, conservado: `dpl_3A2KRCTox1ku5E1EvBSfKbAuiVqG`.
- SHA-256 da migration: `9907e7d326b606a001a278faa4d7f9852959c2ec1c3993b4c5ae3c6819cd547d`.
- A migration foi executada diretamente pelo canal PostgreSQL administrativo existente, com TLS validado, seguindo o método das migrations anteriores. O projeto não tinha tabela de histórico `supabase_migrations.schema_migrations`; não foi criado um segundo sistema de histórico. Não reaplicar o arquivo 36 em um banco onde seus objetos já existem.

## Preservação de dados

Antes da alteração, foi gerado um backup completo no formato custom do `pg_dump`, criptografado com AES-256 e chave protegida por DPAPI do usuário Windows. A descriptografia foi verificada em memória e o catálogo confirmou Auth, identidades, médicos, plantões e documentos. Fontes privadas, backup, chaves e evidências ficaram em `Import/_portal-access-release-20261118`, excluído do Git e da publicação Vercel. Nenhum dump em texto puro foi criado.

A migration foi envolvida em uma transação com bloqueios breves de escrita, tempo máximo de espera e comparação de assinaturas dos dados de 31 tabelas preexistentes, incluindo as tabelas públicas, usuários/identidades Auth e metadados do Storage. Uma divergência provocaria rollback. A comparação após o DDL passou e as políticas RLS existentes também foram preservadas.

| Verificação | Antes e depois |
| --- | ---: |
| Médicos | 92 |
| Plantões | 947 |
| Documentos | 1.350 |
| Credenciamentos | 63 |
| Cadastros bancários | 59 |
| Autorizações provisórias de importação | 365 |
| Usuários Auth | 13 |
| Identidades Auth | 13 |
| Médicos sem Auth vinculado | 90 |

As novas tabelas de operações de acesso e auditoria cadastral permaneceram vazias. Nenhum acesso foi liberado, nenhum convite ou redefinição foi enviado, nenhuma conta foi criada e nenhum cadastro, vínculo, documento ou plantão foi alterado durante a publicação.

O inventário encontrou 33 cadastros sem e-mail válido. Esses valores foram preservados. A liberação individual desses médicos exige que um usuário autorizado confira e regularize o e-mail. Não foram encontradas duplicidades de e-mail por empresa nem divergências entre os e-mails dos cadastros já ligados ao Auth.

## Verificações publicadas

- Build Production concluído na Vercel antes da promoção, usando a configuração existente.
- Conferência do pacote: `Import`, backups, `.env.local`, Git e diretórios privados excluídos.
- Novas tabelas com RLS; leitura direta das operações e execução da finalização negadas a `authenticated`.
- Cargos, concessões expressas e negações individuais verificados no banco real.
- Uma sessão administrativa já existente consultou o perfil editável e o status **Não liberado** de um médico, somente por leitura. Identidade anônima foi recusada.
- Após a promoção: `/login` e `/portal` responderam 200; `/medicos` anônimo redirecionou para `/login`; `/api/health` sem sessão respondeu 401.
- Nova API administrativa sem sessão respondeu 401; origem externa respondeu 403, sem executar ações.
- O domínio oficial foi inspecionado e aponta para o deploy promovido, em estado Ready.

A entrega SMTP, a abertura dos links e a ativação por e-mail não foram exercitadas em produção, respeitando a instrução de não liberar acessos nem enviar convites. A configuração de SMTP e templates não foi modificada. O [guia operacional](perfil-medico-acesso-portal.md) continua sendo a referência para uma futura liberação individual autorizada.
