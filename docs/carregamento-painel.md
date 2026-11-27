# Carregamento do painel por tela, empresa e período

## Problema e comportamento

O bootstrap administrativo consultava médicos, documentos, plantões e usuários antes de mostrar a navegação. Para a administração SaaS, parte dessas consultas abrangia todas as empresas autorizadas. Atualizar o navegador repetia a carga, inclusive em telas que não utilizavam essas coleções.

No diagnóstico de produção anterior à correção, três consultas a `medical_documents` acumularam cerca de 18,2 segundos no PostgreSQL. Esse valor é tempo acumulado das consultas observadas, não uma medição de ponta a ponta. A resposta HTML pública não apresentou a mesma demora.

O layout prepara a sessão, as empresas autorizadas e as preferências no servidor. `StoreHydrator` aplica esse resultado no navegador, sem repetir essas consultas. A navegação fica disponível enquanto `WorkspaceDataBoundary` consulta as coleções da tela. Erros têm recuperação explícita; dados incompletos não são apresentados como totais zerados.

| Tela | Recorte operacional |
| --- | --- |
| Painel | Empresa ativa; união dos períodos de cobertura, agenda e dia atual, sem preencher intervalos entre períodos distantes |
| Escala | Empresa ativa e período exibido, com um dia adicional de cada lado para cobertura noturna |
| Financeiro | Empresa ativa e mês/semana selecionados; histórico completo somente na opção explícita “Todos os períodos” |
| Relatórios | Empresa ativa e período selecionado; metadados documentais necessários às exportações existentes |
| Perfil/pasta de médico | Empresa ativa e identificador do médico; recursos dependentes somente se o cadastro for encontrado |
| Documentação | Metadados da empresa ativa e vínculos operacionais necessários às regras documentais |
| Unidades | Cadastro da empresa; detalhes de uma unidade consultam seus plantões |
| Empresas/Painel SaaS | Contagens autorizadas por empresa, sem transferir todas as entidades para o navegador |
| Usuários SaaS | Relação de usuários apenas nessa tela administrativa |
| Minha conta e telas com API própria | Sem bootstrap de coleções operacionais |

Controles de período registram seus recortes com `useWorkspacePeriod`. Durante a atualização, a página mantém seus estados locais e oculta resultados antigos. Consultas substituídas são canceladas; uma resposta atrasada não pode substituir a empresa ou o usuário atuais. O foco retorna ao controle de período quando aplicável.

## Resumos completos

`WorkspaceOverviewProvider` compartilha os resumos entre cabeçalho, painel e escala, em memória, por usuário/empresa/revisão. Não há persistência de dados clínicos em armazenamento local nem polling.

`GET /api/workspace/overview` usa a sessão autenticada, verificação de sessão ativa e permissões efetivas. As respostas são `private, no-store`. Não utiliza service role.

### Segunda otimização — 27/11/2026

- `loadStaffBootstrap` reaproveita as verificações do servidor, confirma a sessão viva e o perfil ativo, mantém os redirecionamentos de login/portal/troca obrigatória de senha e prepara os dados da própria conta. Empresas, preferências e assinatura do avatar são consultadas em paralelo. Credenciais e tokens não integram o DTO passado ao navegador.
- `StoreHydrator` hidrata uma única vez a partir desse resultado, preservando a empresa selecionada quando autorizada. O store continua persistindo somente o identificador da empresa, sem cadastros médicos ou resumos. A recuperação das preferências pela Minha conta continua disponível.
- Catálogos e plantões de uma tela começam em paralelo. Pastas individuais continuam verificando primeiro a existência e o acesso ao médico antes de consultar seus recursos dependentes.
- O painel usa `part=all` para obter documentação e financeiro em uma requisição autenticada. A verificação de Auth e as permissões são iniciadas em paralelo; nenhuma leitura operacional começa antes de ambas serem aprovadas. O leitor compartilha uma única paginação histórica dos plantões entre os dois resumos. Uma falha documental pode retornar um erro nessa seção e preservar o financeiro válido.
- Documentos são indexados por médico antes da avaliação documental das escalas, preservando os mesmos helpers de negócio e a ordem dos registros.
- As filas operacionais são antecipadas pelo provider compartilhado, sem esperar a montagem do corpo do painel. Atualizações continuam invalidando os resumos por revisão; empresa, usuário, permissões e data fazem parte do contexto. Requisições substituídas são canceladas, sem polling.
- A implantação anterior usava `iad1` (EUA). `vercel.json` passa a escolher somente `gru1` (São Paulo), próximo ao Supabase existente. A seleção de uma única região está disponível no plano Hobby, sem novo serviço, VM ou worker. Referências: [configuração de regiões](https://vercel.com/docs/functions/configuring-functions/region), [regiões e limites de configuração](https://vercel.com/docs/project-configuration/vercel-json), [localização de gru1](https://vercel.com/docs/regions).

Essa segunda otimização **não exige nova migration**. A migration 60 permanece como pré-requisito já instalado; não deve ser reaplicada em produção.

Os testes adicionais executam os leitores reais com uma fronteira Supabase fictícia: conta sem sessão, sessão revogada, perfil inativo, troca obrigatória de senha, escopo por empresa, ausência de credenciais no DTO, concorrência das consultas, pastas inexistentes, saldos antigos, requisitos por unidade, minimização financeira por permissão e sucesso parcial. O navegador também verifica que o bootstrap não repete consultas no cliente, que as filas começam antes do fim da carga da tela e que a falha documental permite recuperar a seção sem perder o resumo financeiro.

Resultado local desta etapa: 208 testes automatizados, 69 verificações de navegador (13 de carregamento, 26 de listagem/perfil, 21 de perfil/status e 9 de cobertura), lint, typecheck, build Webpack e laboratório SQL até a migration 60 aprovados. A regressão de perfil/status foi executada isoladamente após uma falha transitória de manifesto no Next de desenvolvimento. A revisão unslop-ui dos componentes de carregamento manteve o resultado 0 antes/0 depois, sem alterações decorativas.

As medições anteriores estão em `Import/_initial-loading/medicao-producao-2026-11-27.*`; os testes e as novas evidências de publicação ficam em `Import/_loading-v2/`. Comparar com o mesmo viewport e método, distinguindo o tempo observado da automação de métricas internas do navegador. A primeira abertura autenticada usa o cache HTTP já existente; celular significa emulação de viewport na mesma máquina e conexão, sem representar um aparelho físico.

- O financeiro mantém os saldos antigos em aberto. O servidor reaproveita `dashboardPayments` e entrega apenas totais; limitar os plantões visíveis ao mês não elimina dívidas anteriores do resumo.
- A documentação mantém as unidades efetivamente atendidas no histórico e reaproveita `doctorsWithDocumentIssues` e `doctorScheduleCompliance`. As regras existentes de aviso/bloqueio continuam separadas.
- O navegador recebe contagens, identificadores operacionais e os campos profissionais necessários ao resumo, sem arquivos, caminhos de Storage, CPF, contatos ou dados bancários nessa resposta.
- A busca do cabeçalho carrega seu conjunto da empresa sob demanda, sem sobrescrever os dados da página.
- Gravações pelo store invalidam os resumos. A atualização do perfil também invalida o resumo compartilhado. Atualizações posteriores às gravações usam o recorte da tela, sem bootstrap global.

## Migration e segurança

Aplicar `supabase/workspace-loading.preflight.sql` e depois `supabase/60_workspace_loading.sql` antes de publicar o frontend.

A migration cria somente três funções de leitura:

- `nv_workspace_documents`: metadados por empresa/médico, páginas de até 500, cursor por identificador;
- `nv_workspace_document_audit`: histórico documental autorizado, limitado a 1.000 eventos;
- `nv_workspace_organization_counts`: contagens para administração SaaS; campos sem permissão retornam `null`, sem somar resultados parciais como totais globais.

As funções são `STABLE`, `SECURITY DEFINER`, com `search_path` vazio e execução exclusiva de `authenticated`. Verificam a sessão viva e os mesmos controles de autorização já utilizados nas políticas documentais e na administração SaaS. O escopo da empresa e do médico é aplicado explicitamente dentro da função; parâmetros do navegador não concedem autorização. As demais consultas continuam sujeitas ao RLS existente.

Não há DML, criação de contas, liberação de acesso, envio de convites, alteração de senhas, exclusão de cadastros, mudanças em vínculos ou mudanças nas políticas existentes. O procedimento de publicação compara, na mesma transação, dados e segurança das tabelas existentes; qualquer divergência aborta a aplicação. O backup e a evidência detalhada ficam em `Import/`, fora do Git e do pacote Vercel.

Para verificar em banco **descartável**, executar `scripts/test-database.ps1` com o caminho do PostgreSQL 17. O parâmetro opcional `-WorkspaceMigration` permite testar a transação protegida usada na publicação. `workspace-loading.verify.sql` contém fixtures e rollback; nunca executar esse arquivo em produção.

Na aplicação em produção de 26/11/2026, a transação confirmou dados e segurança preservados em 92 tabelas existentes, sem operações de Auth. O inventário manteve 98 médicos, 960 plantões e 1.354 documentos. A revisão automática recusou a exportação de um novo backup completo para armazenamento local por conter dados pessoais/médicos sem autorização específica para esse destino. Essa exportação não foi repetida; a proteção desta migration de funções de leitura foi a comparação transacional dentro do banco, sem exportar os registros.

Se for necessário voltar o frontend, as três funções podem permanecer sem utilização. Não é necessário remover dados nem alterar o Auth.

## Validação

- 198 testes automatizados, incluindo planos de consulta, datas inválidas, ano bissexto, períodos disjuntos e paginação documental sem truncamento.
- 26 verificações de navegador da listagem/perfil e 21 de edição, status, confirmações e toasts, com dados fictícios.
- 11 verificações adicionais de carregamento: navegação durante consultas lentas, dívida histórica, exigência documental por unidade histórica, troca rápida de empresa, cancelamento, falha/retry, recortes de financeiro/relatórios/escala, sessão e permissões.
- 9 fluxos de regressão da cobertura interativa, incluindo salvamento e preservação das alocações existentes, exclusivamente em fixtures locais.
- Banco PostgreSQL descartável: migrations anteriores, leitura de mais de 1.000 metadados, isolamento entre empresas, IDOR, médico sem permissão administrativa, campos agregados por cargo, revogação de usuário e privilégios das funções.
- Capturas locais em 1440, 768, 390 e 360 px, temas claro/escuro, foco e ausência de rolagem horizontal da página; evidências em `Import/_initial-loading/`.

Lint, typecheck, build local e build do candidato Vercel são verificações obrigatórias da publicação. Os testes locais bloqueiam contatos externos ou usam somente loopback e não enviam convites.

### Revisão de interface com unslop-ui

Escopo: estados novos de sessão/carregamento/erro e diff dos consumidores. A estrutura aprovada foi preservada.

| Regra | Antes | Depois | Mantidos |
| --- | --- | --- | --- |
| Candidatos detectados nos componentes de carregamento | 0 | 0 | 0 |
| U4: estados de carregamento, erro e recuperação | Necessários | Necessários | Textos operacionais e botão “Tentar novamente” |

Veredito: nenhum corte necessário nos novos estados. O loader de sessão indica uma operação real; não foram adicionados selos, decoração ou promessas de velocidade. Foi utilizado o conjunto de regras incluído na skill, pois `/pstack:unslop` não está instalado. Não foram removidos avisos ou informações da interface aprovada.

## Consumo e limites

Não há serviço novo, dependência nova, worker, VM, agendamento ou custo recorrente contratado. O carregamento inicial deixa de transferir documentos, plantões e contas de outras empresas. A paginação de metadados evita repetir a autorização custosa por documento.

Os resumos ainda precisam ler o histórico **da empresa selecionada** no servidor para preservar as regras financeiras e documentais. A documentação completa e “Todos os períodos” continuam sendo consultas explicitamente abrangentes. Cadastros de médicos/unidades/setores usados nas telas operacionais continuam completos dentro da empresa; não se trata de paginação universal desses catálogos.

Para volumes muito maiores, avaliar agregados SQL equivalentes e índices com medições reais. Não extrapolar o tempo de fixtures ou de compilação local como ganho garantido em produção: rede, sessão, download de JavaScript e volume de cada empresa continuam influenciando a primeira abertura.
