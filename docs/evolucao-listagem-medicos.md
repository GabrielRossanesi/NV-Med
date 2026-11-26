# Gestão do corpo clínico

## Auditoria e decisões

Base: listagem aprovada, `UserAvatar`, formulários de cadastro e perfil, `Dialog`, confirmações, `notify`, exportadores CSV/XLSX, preferências da conta e permissões efetivas existentes.

- A listagem original lê o bootstrap completo e filtra no navegador; documentos e plantões são percorridos várias vezes por médico. A nova consulta retorna uma página de 25, 50 ou 100 profissionais e agregados por empresa, usando apenas metadados.
- `doctors.rqe` contém um registro legado sem especialidade associada. Não há validação oficial. O valor é preservado integralmente e apresentado como sem vínculo identificado. A tabela incremental `doctor_rqes` aceita até 20 registros pelo editor, com especialidade opcional. Não há backfill ou associação presumida. Um registro estruturado explícito com o mesmo número substitui somente sua apresentação duplicada; a coluna legada permanece intacta.
- A especialidade principal vem do cadastro. As adicionais autorizadas vêm de `doctor_enrollments.approved_specialties`; solicitações ainda em análise não equivalem a especialidades autorizadas.
- O contrato existente é `contract_model` (PF, PJ ou SCP) e `contract_signed` (booleano). Não existe entidade contratual que permita distinguir ausência de contrato e contrato pendente. A interface manterá os dois estados reais, sem criar um terceiro fictício.
- O Portal Médico usa os estados não liberado, convite pendente, ativo e bloqueado do fluxo atual. Não há liberação em massa. Cadastro inativo já restringe o uso do portal pela regra existente, sem alterar a conta Auth; a confirmação de status explica esse efeito.
- Não há foto administrativa do médico: `user_accounts.avatar` é uma imagem privada da conta. A listagem manterá a inicial aprovada sem gerar URLs assinadas por linha ou expor avatares de outras contas.
- Último plantão realizado será determinado exclusivamente por plantão `completed` cujo término já ocorreu; plantão confirmado no passado não prova realização.
- As unidades atendidas são derivadas dos plantões não cancelados, sem confundi-las com unidades autorizadas no credenciamento.
- Comunicação externa não está implementada. Solicitações documentais reutilizam notificações internas apenas para contas vinculadas, ativadas e disponíveis; médicos sem acesso são reportados como não notificados. Não são enviados e-mails ou convites.
- As preferências estendem `account_preferences`, mantendo a densidade já compartilhada com Minha conta. Não há outra chave de armazenamento concorrente. Nome, CRM, status, seleção e ações permanecem disponíveis na personalização.
- A exclusão definitiva foi retirada desta listagem. A inativação preserva vínculos, financeiro e auditoria. Nenhum plantão é cancelado automaticamente. RQEs possuem vínculo composto com o médico e cascata somente pela empresa, compatível com a exclusão de empresa já controlada por retenção/MFA. O registro de operações segue a retenção independente da auditoria de perfil.

## Validação por etapa

1. Auditoria técnica: modelo e permissões identificados; workspace inicialmente limpo.
2. Indicadores e filtros: seis atalhos, contexto geral da empresa, busca com debounce de 300 ms, filtros principais e avançados, chips removíveis, combinação de filtros e URL validados em testes SQL e navegador.
3. Tabela, ordenação e paginação: avatares preservados, nomes clicáveis, RQEs e especialidades adicionais, unidades resumidas, popovers acessíveis, cabeçalho fixo e paginação/ordenação determinísticas no servidor.
4. Operações administrativas e exportação: seleção limitada à página, confirmação, resultados parciais, proteção contra repetição, solicitações documentais internas e CSV/XLSX dos três escopos. Alterações relevantes usam a auditoria existente; o log privado de operações armazena ator, empresa, requisição, ação, instante e resultado agregado da exportação.
5. Preferências: quantidade, ordenação, densidade e colunas disponíveis tanto na listagem quanto em Minha conta, por um componente e pelas RPCs já existentes.
6. Auditoria final: lint, typecheck, suíte automatizada, SQL descartável, regressão de status/perfil e testes visuais descritos abaixo.

## Interface e componentes

A composição mantém a paleta, tipografia, avatares e tokens do NV Med. A tabela continua sendo a área principal; os indicadores formam uma faixa compacta, sem novos cards de dashboard. Filtros avançados começam recolhidos em todas as resoluções. A rolagem horizontal fica restrita à tabela, com foco por teclado; o menu usa popover nativo na camada superior e permanece acessível em celular.

Reutilizados: `UserAvatar`, `DoctorProfileFields`, `DoctorBankingFields`, `DoctorProfileEditor`, `DoctorProfileHistory`, `DoctorPortalAccess`, `Dialog`, `useConfirmation`, `notify`, `useLocationHash`, `readBoundedBody`, CSV com proteção de fórmulas, `write-excel-file` e preferências da conta. O formulário de cadastro foi extraído preservando **Salvar e enviar documentos**. Não houve alteração no fluxo de uploads nem no acervo documental.

## Consulta e consumo de recursos

- O bootstrap leve de `/medicos` busca apenas a sessão, empresa e preferências, sem todos os médicos, documentos, plantões ou históricos. Ao abrir outra área, o bootstrap completo existente é retomado. O alerta documental do cabeçalho recebe o agregado da listagem, preservando sua função.
- Uma RPC atende cada mudança efetiva de filtro/página/ordenação; buscas rápidas são agrupadas e requisições substituídas são abortadas. Não há polling. Contadores são agregados por médico distinto e não mudam conforme os filtros.
- Os agregados documentais são materializados uma única vez por consulta. O plano inicial recalculava agregados em laços; a materialização eliminou esse custo. Índices compostos apoiam os recortes por empresa e relacionamentos. A busca por substring normaliza acentos e varre o escopo autorizado no servidor; não foi adicionada uma extensão de busca. Estatísticas atualizadas continuam importantes após grandes importações.
- Ensaio local com 1.125 médicos: aproximadamente 94 ms para a página de 25 e 158 ms para busca + especialidade + RQE + documentação, com cerca de 12,9 KB de JSON por página. O teste tem limite de regressão de 5 s, não um SLA de produção. A latência real depende do ambiente e do volume.
- Exportações são limitadas a 10.000 profissionais e 16 MB de dados intermediários; o arquivo HTTP tem limite de 4 MB para permanecer dentro da infraestrutura atual. Arquivos maiores exigem filtros ou seleções menores.
- Não há dependências, serviços externos, VMs ou workers adicionais. O custo marginal se limita a consultas, índices e registros de auditoria no Supabase existente. Não são carregados arquivos médicos nem geradas URLs assinadas por profissional.

## Segurança

As RPCs validam `nv_can_action` por empresa. Campos documentais, unidades/plantões e acesso ao portal respeitam permissões próprias; filtros não autorizados são recusados e os dados correspondentes são suprimidos. As tabelas novas têm RLS e nenhum acesso direto para os papéis de aplicação. Helpers privados não são executáveis por `authenticated`, `anon` ou `service_role`.

Alterações em massa, edição de RQEs e exportação exigem a sessão MFA administrativa válida existente. IDs enviados pelo cliente são conferidos contra a empresa no backend. O lote verifica revisões por médico, isola falhas em subtransações e serializa a chave de idempotência por ator/requisição. Repetir a mesma requisição não duplica alterações ou notificações; reutilizá-la com outro conteúdo é recusado.

A exportação exige também leitura de relatórios, seguindo a permissão usada nos relatórios existentes. A rota usa sessão autenticada, origem estrita, corpo limitado inclusive em streaming, respostas privadas sem cache e mensagens públicas conhecidas. CSV neutraliza fórmulas; XLSX usa células textuais, inclusive para CRM com zeros iniciais. CPF, contatos pessoais, dados bancários, credenciais e caminhos de documentos não integram os arquivos.

## Validações e evidências

- `npm test`: 187 testes aprovados.
- `npm run lint`: aprovado.
- `npx tsc --noEmit`: aprovado.
- `scripts/test-database.ps1`: baseline e migrations até 59, inclusive preservação de Auth/plantões, isolamento, metadados, múltiplos RQEs, especialidade sem associação, falhas parciais, idempotência, MFA e preferências.
- `scripts/doctor-status.browser.mjs`: 21 cenários de regressão de status/perfil. Os testes de avatares foram incorporados à suíte específica da listagem.
- `scripts/doctor-directory.browser.mjs`: 20 cenários aprovados, cobrindo filtros e indicadores, respostas atrasadas, paginação/retorno do perfil, menus e popovers por teclado, seleção, lote parcial, editor de RQEs, atalhos de contrato/histórico, CSV/XLSX, preferências/Minha conta, cadastro, permissões, erros e estados vazios. Capturas em 1440, 768, 390 e 360 px, nos temas claro e escuro, incluindo tabela e menu no celular.
- Build de produção local com Webpack aprovado. A execução padrão de Turbopack no Windows falhou ao iniciar o processo auxiliar de CSS de `Account.module.css`; o bundler de produção não foi alterado. A publicação exige também um build remoto aprovado na Vercel antes da promoção do domínio.

Evidências locais fictícias, fora do Git e do deploy: `Import/_doctor-directory/` e a suíte anterior em `Import/_status-ui-20261125/`. Scripts externos injetados pelo antivírus do host foram bloqueados pelo teste; nenhuma conexão de dados com produção foi realizada.

### Revisão unslop-ui

Escopo original: página e avatar, mesma contagem antes/depois. Componentes extraídos foram revisados separadamente.

| Regra | Antes | Depois | Mantidos |
| --- | ---: | ---: | ---: |
| U1, candidatos no escopo original | 3 | 0 | 0 |
| U10, componentes novos | Não se aplica | 1 | 1 |

Mantidos por função: skeleton de carregamento (U10), ícones de estado, avatar e ícone genérico para nome inválido (U11), instrução sobre RQE sem vínculo, confirmação do efeito de inativação e informações de recuperação de erro (U4/U7). Não são elementos decorativos. A revisão manual preservou os estados operacionais, os rótulos acessíveis e a paleta aprovada.

## Publicação

Publicação autorizada pelo responsável em 26/11/2026, após os testes. A migration `supabase/59_doctor_directory.sql` foi aplicada no Supabase após preflight, backup com catálogo e SHA-256 verificados e teste em PostgreSQL descartável. A transação de aplicação comparou contagens e hashes de todas as 90 tabelas existentes em `public`, `auth` e `storage`, além de RLS, permissões e gatilhos preexistentes. Todas as verificações de preservação passaram; as tabelas novas permaneceram vazias e não houve operações de acesso ao portal.

O SQL usa transação e `lock_timeout` de 5 s; se não obtiver o lock, interromper e replanejar a janela. Não modifica cadastros ou vínculos, não faz backfill e não altera Auth. A publicação da interface usa um candidato de produção sem promover o domínio automaticamente; conferir build remoto e SHA do commit antes da promoção. Backups e evidências privadas em `Import/` estão excluídos do Git e do pacote da Vercel.

Não executar convites, redefinições ou liberações durante instalação ou teste. A interface depende das RPCs da migration 59 e apresenta erro explícito caso o banco local ainda não tenha recebido a extensão. O pós-check de produção confirmou RPC autenticada, chamada anônima proibida, RLS nas duas tabelas novas e contagens originais de médicos, plantões, documentos e usuários Auth.

## Arquivos da entrega

- Página: `src/app/(dashboard)/medicos/page.tsx`.
- Diretório de componentes: `src/components/doctors/{DoctorDirectory,DoctorDirectoryFilters,DoctorDirectoryTable,DoctorListingPreferenceFields,useDoctorDirectory}.tsx` (o hook usa `.ts`).
- Componentes compartilhados: `src/components/{ContextMenu,DetailList,DoctorCreateDialog,DoctorRqePanel,DoctorProfileEditor,DoctorProfileHistory,StoreHydrator,Header}.tsx`.
- Perfil e conta: `src/app/(dashboard)/medicos/[id]/page.tsx`, `src/components/account/AccountPreferences.tsx`, `src/lib/account.ts`, `src/store/useStore.ts`.
- Consulta/exportação: `src/lib/doctorDirectory.ts`, `src/lib/doctorDirectoryExport.ts`, `src/lib/csv.ts`, `src/services/supabaseService.ts`, `src/app/api/reports/doctors/route.ts`.
- Banco: `supabase/59_doctor_directory.sql`, `supabase/doctor-directory.preflight.sql`, `supabase/doctor-directory.verify.sql`.
- Testes: `scripts/doctor-directory.test.mjs`, `scripts/doctor-directory.browser.mjs`, `scripts/fixtures/doctor-directory.mjs`, `scripts/doctor-status.browser.mjs`, `scripts/test-database.ps1`.
- Documentação: este arquivo.

## Limitações preservadas

| Conceito | Fonte e interpretação |
| --- | --- |
| Cadastro | `doctors.status`: ativo, pendente ou inativo. Alteração explícita e auditada. |
| Credenciamento | `doctor_enrollments.status`: pendente, aprovado, rejeitado ou correção solicitada; ausência de linha significa não iniciado. Mantido no fluxo de credenciamento existente. |
| Documentação | Metadados e requisitos: completa, pendente, vencida e próxima do vencimento, com condições simultâneas possíveis. |
| Contrato | Flag real de contrato assinado e modalidade PF/PJ/SCP. Ausência de entidade contratual impede inferir um estado separado de não cadastrado. |
| Portal | Vínculo com Auth e regras existentes: não liberado, convite pendente, ativo e bloqueado. Sem criação ou liberação automática. |
| Elegibilidade | Nenhuma nova regra de bloqueio foi introduzida. As regras existentes de escala e credenciamento continuam próprias de seus módulos. |

Sem integração oficial para validar CRM/RQE, sem estado contratual inexistente, sem foto administrativa disponível, sem comunicação externa e sem liberação de portal em massa. Não foram criados filtros de validação fictícios, bloqueios novos de escala ou mecanismos de exclusão definitiva nesta tela. A listagem mostra especialidades principais/autorizadas; solicitações de credenciamento ainda em análise permanecem no fluxo próprio.

CRM/UF continua sendo o registro principal existente. Uma evolução futura para múltiplas inscrições por UF deve manter os identificadores e históricos do médico, com migração própria e revisão de duplicidades, sem converter RQEs legados em associações presumidas.

## Evoluções futuras

Validação de CRM/RQE depende de acesso oficial autorizado, condições de uso, custo e limites. Histórico de validações deve registrar fonte, consulta, data e resultado, separado da mera existência do registro. Favoritos podem estender preferências após definição do produto. Regras de credenciamento e elegibilidade devem ser configuráveis por empresa/unidade/especialidade e aprovadas antes de qualquer bloqueio novo de escala.
