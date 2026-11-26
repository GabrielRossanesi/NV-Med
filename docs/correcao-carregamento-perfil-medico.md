# Carregamento do perfil médico

Correção de 26/11/2026.

## Causa e comportamento

O perfil dependia do bootstrap completo do painel. Antes de mostrar a ficha, carregava todos os médicos, documentos, plantões, usuários, setores e histórico documental acessíveis ao administrativo. A paginação desse conjunto, especialmente dos documentos, atrasava a abertura mesmo quando o médico tinha poucos registros.

O bootstrap agora recebe um recorte de médico e empresa. Primeiro valida a sessão, o usuário ativo e a empresa acessível, depois consulta o médico com `id` e `organization_id`. Somente quando encontra o cadastro busca seus documentos e plantões, sempre com `doctor_id` e `organization_id`, e as unidades da empresa ativa. A paginação de 500 linhas e a ordenação por identificador preservam históricos extensos; a tela continua mostrando os cinco plantões recentes e todas as unidades efetivamente atendidas.

Não carrega os demais médicos, usuários, setores ou o histórico documental global para abrir a ficha. Os painéis especializados continuam usando as RPCs existentes. Atualizações da Escala Master também recarregam o recorte do médico, com proteção contra aplicação de uma resposta após sair do perfil.

## Contexto, segurança e interface

- A chave de carregamento inclui o identificador do médico e a empresa ativa. Trocar de perfil ou de empresa recarrega o recorte e cancela requisições anteriores; consultas do perfil têm cancelamento após 25 segundos e falhas oferecem nova tentativa com mensagem pública.
- O campo transitório `dataScope` identifica dados completos, da listagem ou de um perfil. Não é uma preferência persistida. O cabeçalho não calcula totais da empresa sobre dados parciais de um médico.
- A busca global carrega o conjunto completo somente quando é explicitamente aberta e informa carregamento ou falha. Seu mecanismo de busca continua o existente; uma busca remota específica pode otimizar esse fluxo futuramente.
- Os filtros de empresa também são aplicados ao administrativo SaaS. Um identificador de outra empresa não inicia consultas dos recursos dependentes.
- RLS, autenticação, MFA, permissões, RPCs de edição, auditoria e confirmação continuam os existentes. Dados pessoais permanecem no fluxo próprio de leitura autorizada.
- Não há migration, alteração de cadastros ou vínculos, backfill, criação de credenciais, liberação de acesso ou envio de convites.
- A composição visual, formulários, confirmação e toasts foram preservados.

## Validação

- 187 testes automatizados aprovados.
- 26 cenários de listagem/perfil e 21 de status/edição aprovados, em navegador local com dados fictícios e conexões externas bloqueadas.
- O cenário de abertura direta trouxe um documento do médico em uma base fictícia de 1.354 documentos, sem consultas documentais globais. A abertura levou aproximadamente 1 segundo no laboratório; essa medição não representa uma garantia de latência de produção.
- Verificados: filtros e retorno do perfil, edição existente, salvamento e recarga, isolamento do recorte entre empresas e médicos, cadastro inexistente sem consultas dependentes, erro seguro e nova tentativa, busca global sob demanda e permissões de leitura.
- Capturas e testes de regressão em desktop e celular, temas claro e escuro. Evidências privadas em `Import/_doctor-directory/` e `Import/_status-ui-20261125/`, excluídas do Git e do deploy.
- Lint e typecheck aprovados. A publicação exige build local de produção e build remoto da Vercel aprovados antes da promoção do domínio.

### Revisão unslop-ui

Escopo: `StoreHydrator` e `DashboardSearch`, sem alterações de layout ou decoração. O fallback de regras da skill foi utilizado porque `/pstack:unslop` não está instalado.

| Regra | Antes | Depois | Mantidos |
| --- | ---: | ---: | ---: |
| U6, informações encadeadas | 3 | 3 | 3 |
| Demais regras do contador | 0 | 0 | 0 |

Mantidos por função: CRM/UF e especialidade, identificação de unidades e data/horário dos plantões nos resultados da busca. As mensagens novas indicam carregamento, tempo excedido ou recuperação de erro, sem promessas de velocidade na interface.

## Arquivos

`src/services/supabaseService.ts`, `src/components/StoreHydrator.tsx`, `src/store/useStore.ts`, `src/components/Header.tsx`, `src/components/DashboardSearch.tsx`, `src/app/(dashboard)/medicos/[id]/page.tsx` e `scripts/doctor-directory.browser.mjs`, além desta documentação e da referência na documentação da listagem.

## Publicação

Commit, push e deploy autorizados pelo responsável após os testes. Utilizar candidato de produção com `--skip-domain`, conferir estado `READY`, build remoto e SHA antes de promover o domínio. Validar a abertura do perfil fictício em produção sem salvar dados, abrir arquivos ou executar ações de acesso; restaurar o contexto do navegador ao concluir.
