# Relatório de auditoria de segurança do NV Med

**Data da auditoria inicial** 23 de novembro de 2026

**Revisão auditada originalmente** `0f3d66e1f07676162c79c38a3c9e9c4aa0a3bf21`

**Escopo** Next.js, rotas HTTP, Supabase Auth, Data API, políticas RLS, funções SQL, Storage e dependências registradas.

## Validação em produção em 23 de novembro de 2026

**Resultado** Oito correções foram verificadas no ambiente publicado. O **NV-06 permanece pendente**. O domínio oficial apontava para o deploy `dpl_JCJ6EzSVoTZt6ACkUCZoLeTQvv7L`, com Node.js 24.x e PostgreSQL 17.11. O catálogo confirmou as migrations 40, 41, 42, 43, 45 e 46. [Deploy verificado](https://vercel.com/gabrielrossanesis-projects/nvmed/JCJ6EzSVoTZt6ACkUCZoLeTQvv7L)

| Achado | Estado | Evidência da validação |
| --- | --- | --- |
| **NV-01** | Validado na Data API | Com a conta sintética de Escalista, a escrita direta de `linked_units` retornou `42501`. A alteração de `contract_signed` funcionou e os vínculos permaneceram iguais. |
| **NV-02** | Validado no banco | O check-out por GPS ficou pendente e o próprio solicitante não pôde aprová-lo. O banco recusou a conclusão direta e a baixa com revisão pendente ou rejeitada. A confirmação independente permitiu concluir e baixar o plantão sintético, com justificativa e autoria registradas. O cenário manual também passou. |
| **NV-03** | Validado na aplicação e no Auth | A mesma alteração administrativa de um perfil sintético retornou HTTP `403` com sessão de senha e HTTP `200` após confirmar TOTP na conta sintética de Diretor. |
| **NV-04** | Validado no build e no lockfile | Os logs da Vercel registraram Next.js `16.4.6`. O hash do lockfile enviado à Vercel coincide com o arquivo auditado, que fixa Sharp `0.35.5`. O `npm audit --omit=dev` reportou zero vulnerabilidades e a rota publicada processou um PNG sintético com Sharp. O teste também confirmou resposta no domínio com Node.js 24.x. |
| **NV-05** | Validado na Data API e no banco | A consulta direta de telefone e e-mail retornou `42501`. A ficha do Escalista omitiu CPF, telefone, e-mail, endereço e nascimento. A ficha do Diretor com permissão retornou o telefone sintético. No ensaio SQL, o titular e o revisor autorizado receberam os dados previstos e o operador SaaS não recebeu CPF. |
| **NV-06** | **Pendente em produção** | A migration 44, o ClamAV e o worker permanecem adiados. O catálogo confirma a ausência da fila de análise. Os buckets estão privados e o acesso autorizado a documentos segue disponível sem análise antimalware. |
| **NV-07** | Validado no banco | O expurgo incluiu as versões atual e histórica, reteve uma empresa com bloqueio e permaneceu pendente após limpeza parcial. A retomada reconheceu a conta exclusiva já removida e preservou a identidade compartilhada e os objetos de outra empresa. Uma empresa sintética sem itens pendentes pôde concluir. A falha de limpeza do Storage foi simulada pela permanência dos objetos no inventário. |
| **NV-08** | Validado na aplicação e no Storage | O PNG válido retornou HTTP `200` e foi lido do Storage no formato esperado. O mesmo PNG declarado como JPEG retornou `415`. O corpo acima do limite retornou `413` na borda da Vercel. A leitura limitada dentro da rota também foi exercitada na suíte local. |
| **NV-09** | Validado por catálogo e Data API | O provisionamento passou no estado de quarentena adiada. Os dois buckets estavam privados, o catálogo registrou zero políticas permissivas com nomes legados e a leitura anônima da linha sintética retornou `42501`. A desativação do instalador histórico foi validada no laboratório. |

Os cenários SQL de presença, minimização e expurgo usaram transações revertidas. O teste HTTP usou uma empresa, duas contas e um avatar sintéticos. A limpeza foi confirmada por consulta independente ao banco. Restaram zero registros operacionais sintéticos e o inventário dos **881 arquivos privados** coincidiu com o manifesto anterior aos testes. A validação do expurgo em produção cobriu a lógica do banco e a reconciliação. O fluxo administrativo completo de remoção por HTTP, Storage e Auth ficou fora desse ensaio.

## Resumo executivo da auditoria inicial

Foram registrados **9 achados** no repositório, com **4 de severidade alta, 4 média e 1 baixa**. A principal falha de autorização é a possibilidade de alterar as unidades autorizadas de um médico com permissão de edição cadastral, sem passar pela aprovação do credenciamento. O registro de presença aceita coordenadas declaradas pelo cliente e pode marcar um plantão como concluído. As versões do Next.js e do Sharp também estão em faixas afetadas por avisos oficiais. A exposição a esses avisos depende do ambiente publicado e dos recursos em uso.

| ID | Severidade | Achado | Evidência |
| --- | --- | --- | --- |
| NV-01 | Alta | Edição cadastral pode ampliar vínculos de credenciamento | Grants, RLS, triggers e fluxo de aprovação |
| NV-02 | Alta | Presença aceita localização sem prova de origem | Contrato da RPC e efeito no estado do plantão |
| NV-03 | Alta | Operações privilegiadas sem exigência de MFA | Rotas administrativas e verificação de sessão versionadas |
| NV-04 | Alta | Next.js e Sharp em versões afetadas por avisos de segurança | Lockfile e avisos do fornecedor. Exposição depende do ambiente |
| NV-05 | Média | Dados pessoais de médicos retornados integralmente a perfis operacionais | Grants, matriz de papéis e consultas do painel |
| NV-06 | Média | Documentos enviados ficam disponíveis sem quarentena ou análise antimalware no fluxo | Upload, persistência e disponibilização de arquivos |
| NV-07 | Média | Exclusão de empresa pode deixar documentos históricos e contas residuais | Coleta incompleta de objetos e resultado de limpeza ignorado |
| NV-08 | Média | Upload de foto processa o corpo antes do limite e confia no MIME declarado | Ordem do processamento e validação de avatar |
| NV-09 | Baixa | Instalador histórico inclui políticas públicas de leitura e escrita | Scripts de demonstração. Impacto crítico se usados isoladamente com dados reais |

A severidade considera o contexto do NV Med, os privilégios necessários, o alcance e o efeito sobre dados ou operações. O risco do instalador histórico é classificado pela probabilidade de uso indevido, pois o guia o identifica como legado. O texto indica as condições de cada achado e o que falta verificar no ambiente hospedado.

## Método e cobertura da auditoria inicial

- Usei o módulo de aplicações web da coleção `mukul975/Anthropic-Cybersecurity-Skills` para inventariar entradas HTTP, fluxos de autenticação e sessão, operações privilegiadas e uploads. A busca de segredos seguiu a abordagem de revisar a árvore e o histórico com saída restrita a nomes de arquivos. [Aplicações web](https://github.com/mukul975/Anthropic-Cybersecurity-Skills/blob/main/skills/performing-web-application-penetration-test/SKILL.md) · [Inspeção de segredos](https://github.com/mukul975/Anthropic-Cybersecurity-Skills/blob/main/skills/implementing-secret-scanning-with-gitleaks/SKILL.md)
- Adaptei os módulos PTES de `bob-reis/claude-pentest-skills` para identificar ativos, mapear as fronteiras de autorização e documentar evidência, impacto e prioridade. Usei também a skill local `cybersecurity-unified` para orientar a auditoria defensiva. [Modelagem de ameaças](https://github.com/bob-reis/claude-pentest-skills/blob/main/pentest-threat-modeling/SKILL.md) · [Relatório PTES](https://github.com/bob-reis/claude-pentest-skills/blob/main/pentest-reporting/SKILL.md)
- Revisei as fronteiras entre navegador, rotas Next.js, Supabase Auth, Data API e funções SQL, além dos acessos privilegiados via `service_role` e do Storage. Os ativos avaliados incluíram contas administrativas, cadastros com CPF, dados bancários, documentos de credenciamento, vínculos de unidades e registros de presença e pagamentos. A análise considerou o visitante anônimo, o médico autenticado e os operadores com diferentes permissões, dentro e fora da empresa.
- A configuração de produção foi examinada por meio dos registros versionados de publicação. Esses registros documentam a publicação da migration 38 em 18 de novembro de 2026, em outro commit. A revisão atual cobre os scripts até a migration 39. A auditoria não fez requisições aos serviços do NV Med nem leu dados reais, segredos de ambiente ou o diretório operacional `Import`. [Registro da publicação](publicacao-escalas-migration38.md#versão-publicada) · [Guia das migrations](../supabase/README.md)

## Achados técnicos da auditoria inicial

### NV-01 · Alta · Edição cadastral pode ampliar vínculos de credenciamento

**Evidência.** O banco permite `UPDATE` de `doctors` por `medicos.edit`, e o cliente envia `linked_units` no caminho de edição direta. O trigger de vínculos verifica apenas se a unidade pertence à mesma empresa. O fluxo de aprovação exige `medicos.approve`, registra a decisão e preenche o mesmo `linked_units`. A elegibilidade para plantões consulta esse campo atual, inclusive para médicos já aprovados. A matriz atribui `medicos.edit`, sem `medicos.approve`, ao papel padrão Escalista. [Grants gerais](../supabase/05_production.sql#L38) · [Política e papéis](../supabase/27_effective_permissions.sql#L54) · [Política de atualização](../supabase/27_effective_permissions.sql#L320) · [Edição direta](../src/services/supabaseService.ts#L417) · [Trigger de vínculos](../supabase/15_fix_unit_link_trigger.sql#L18) · [Aprovação](../supabase/36_doctor_profile_access.sql#L330) · [Elegibilidade](../supabase/31_sector_primary_specialty.sql#L117)

**Impacto.** Um operador com edição cadastral pode ampliar ou remover os vínculos de um médico já aprovado dentro da mesma empresa, sem a decisão de credenciamento correspondente. Ainda se aplicam as verificações de empresa, unidade ativa, especialidade aprovada e demais condições de cada operação. A mudança genérica pode aparecer no histórico cadastral, sem o registro da decisão de credenciamento. A edição direta também permite que a especialidade principal deixe de coincidir com a lista aprovada, embora a elegibilidade continue exigindo uma especialidade aprovada. [Regra do editor de perfil](../supabase/36_doctor_profile_access.sql#L119) · [Auditoria cadastral](../supabase/36_doctor_profile_access.sql#L87) · [Fluxo documentado](perfil-medico-acesso-portal.md)

**Critério de aceite.** A autorização de vínculos deve ser verificada no banco em todos os caminhos efetivos de atualização. Um perfil com edição cadastral deve poder manter os campos de seu escopo, e as mudanças em campos sujeitos a aprovação devem exigir a permissão e a trilha previstas.

### NV-02 · Alta · Presença aceita localização sem prova de origem

**Evidência.** O portal encaminha latitude, longitude e precisão do navegador à RPC `nv_record_attendance`, executável por `authenticated`. A função valida vínculo, credenciamento, distância, precisão declarada, janela de tempo e duplicidade. No check-out aceito, grava a presença e muda o plantão para `completed`. O contrato não contém uma fonte independente que comprove a origem das coordenadas. [Cliente de presença](../src/components/schedule/PresencePanel.tsx#L33) · [Validação e registro](../supabase/21_shift_attendance.sql#L92) · [Permissão de execução](../supabase/21_shift_attendance.sql#L236)

**Impacto.** Um médico autenticado e elegível pode registrar presença com localização declarada sem comprovar que estava na unidade, desde que as demais condições da função sejam satisfeitas. O registro influencia a evidência operacional de cumprimento do plantão. Pagamento automático decorrente desse evento não foi verificado.

**Critério de aceite.** Tratar geolocalização do navegador como evidência declaratória. Se a presença fundamentar liquidação ou decisões contratuais, exigir confirmação independente, adequada à operação da unidade e registrada em auditoria.

### NV-03 · Alta · Operações privilegiadas sem exigência de MFA

**Evidência.** O login versionado usa senha. A verificação compartilhada confirma o usuário no Supabase Auth e consulta `nv_session_ready`. As rotas de redefinição administrativa de senha e exclusão de empresa verificam origem, sessão e perfil, sem exigir nível de autenticação `aal2` ou reautenticação recente. As verificações de sessão versionadas contêm regras de conta ativa, bloqueio e ciclo de senha. Nenhuma regra `aal2` foi localizada em `src` ou nas migrations examinadas. [Login](../src/app/login/page.tsx#L52) · [Verificação de usuário](../src/lib/supabase/authorizedUser.ts#L4) · [Sessão no banco](../supabase/19_doctor_portal.sql#L61) · [Senha administrativa](../src/app/api/admin/users/password/route.ts#L7) · [Exclusão de empresa](../src/app/api/admin/organizations/route.ts#L12) · [MFA no Supabase](https://supabase.com/docs/guides/auth/auth-mfa)

**Impacto.** O comprometimento de uma conta privilegiada pode dar acesso a redefinições administrativas e, para o CEO, à exclusão de empresas. A configuração de autenticação externa à revisão versionada não foi inspecionada.

**Critério de aceite.** Exigir autenticação multifator nas operações administrativas de alto impacto e verificar a regra no servidor e nas RPCs que dão acesso equivalente. Uma sessão com apenas senha deve ser insuficiente para essas operações.

### NV-04 · Alta · Next.js e Sharp em versões afetadas por avisos de segurança

**Evidência.** O manifesto fixa `next@16.2.9`, também confirmado no commit da publicação documentada de 18 de novembro. O lockfile fixa `sharp@0.34.5`. O registro de publicação aponta para a Vercel, enquanto o repositório também fornece um inicializador Windows. A severidade alta se refere ao risco de manter o conjunto de dependências vulnerável. O impacto dos avisos críticos abaixo depende do ambiente. [Manifesto](../package.json#L18) · [Next.js no lockfile](../package-lock.json#L5296) · [Sharp no lockfile](../package-lock.json#L6043) · [Inicializador local](../iniciar-nv-med.bat#L42) · [Registro de produção](publicacao-escalas-migration38.md#versão-publicada)

| Aviso | Relevância para esta revisão |
| --- | --- |
| [CVE-2026-96889](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) | Aviso crítico para otimização de imagens SVG em Linux com glibc. A versão fixada do Sharp está abaixo de `0.35.5`, indicada pelo fornecedor. O otimizador e a versão nativa efetiva precisam ser verificados no ambiente hospedado. |
| [GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) | Aviso crítico para servidor Next.js em sistema de arquivos Windows. A versão fixada e o uso de App Router sem Cache Components coincidem com o cenário versionado. O risco depende da execução e da exposição desse servidor. |
| [GHSA-7qx7-33qx-rqx2](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2) | Desrespeito à rejeição de SVG no otimizador. A versão está na faixa afetada. A exposição depende do otimizador e das origens de imagem disponíveis. |
| [GHSA-39w2-rjm5-chcv](https://github.com/vercel/next.js/security/advisories/GHSA-39w2-rjm5-chcv) | Divulgação de dados por endpoint MCP do servidor de desenvolvimento. O inicializador usa `next dev`, e a versão local habilita o recurso por padrão. O aviso se aplica ao desenvolvimento. |
| [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) · [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r) | A versão do Next.js está nas faixas afetadas. Os caminhos descritos nos avisos requerem Cache Components com um uso específico de `use cache` ou pelo menos uma Server Action. Esses pré-requisitos não foram localizados no código da aplicação. |
| [GHSA-6gpp-xcg3-4w24](https://github.com/vercel/next.js/security/advisories/GHSA-6gpp-xcg3-4w24) | O aviso de contorno de Proxy exige uma configuração `i18n.locales` com uma única entrada. O requisito não aparece na configuração versionada do NV Med. |
| [GHSA-qx2v-qp2m-jg93](https://github.com/postcss/postcss/security/advisories/GHSA-qx2v-qp2m-jg93) · [GHSA-fxqj-rqcc-2cmp](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp) | As versões de PostCSS do Next.js e da compilação estão em faixas afetadas por avisos sobre CSS e mapas de origem. A revisão não identificou entrada pública de CSS ou mapas processados por essas ferramentas. [PostCSS no lockfile](../package-lock.json#L5349) |

O `npm audit --omit=dev` sinalizou seis pacotes. A ferramenta classificou `next` como crítico, `sharp`, `postcss`, `nanoid` e `source-map-js` como altos, e `baseline-browser-mapping` como moderado. Esses totais se referem a pacotes sinalizados no lockfile. Os três últimos são transitivos, e a revisão não identificou entrada HTTP do NV Med que controle tamanho de ID, opções do mapeamento de navegadores ou mapas de origem. [Nano ID](https://github.com/advisories/GHSA-2v37-7h3g-55p8) · [Source Map JS](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) · [Baseline Browser Mapping](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv)

A auditoria incluindo desenvolvimento sinalizou 18 pacotes no total, com 1 crítico, 8 altos e 9 moderados. Entre os 12 resultados adicionais estão `brace-expansion`, `browserslist`, `js-yaml`, `minimatch` e `zod`, além de pacotes do Tailwind e do TypeScript ESLint sinalizados por dependências. Esses pacotes adicionais não foram classificados como falhas independentes da aplicação. [Brace Expansion](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) · [Browserslist](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) · [JS-YAML](https://github.com/advisories/GHSA-52cp-r559-cp3m) · [Minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) · [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

**Critério de aceite.** Confirmar a versão instalada e o runtime real de cada ambiente. A versão liberada deve cobrir os avisos de outubro e novembro, com `16.4.5` como piso para essa combinação de correções, ou versão estável posterior com os mesmos patches. Rodar novamente a análise do lockfile para verificar as transitivas. Validar a compilação, os fluxos autenticados e a configuração do otimizador. [Comunicado de outubro](https://nextjs.org/blog/nextjs-security-update-october-14-2026) · [Comunicado de novembro](https://nextjs.org/blog/november-2026-security-release)

### NV-05 · Média · Dados pessoais de médicos retornados integralmente a perfis operacionais

**Evidência.** A hidratação administrativa carrega todas as colunas das tabelas consultadas, incluindo `doctors`. A política de leitura de médicos autoriza por papel e empresa e concede acesso à linha inteira, incluindo CPF, telefone, e-mail e endereço. `medicos.view` é concedido a perfis operacionais, inclusive Escalista. A RPC de perfil devolve o registro quase integral e a data de nascimento quando existente. Para papéis SaaS com a permissão, o escopo pode abranger mais de uma empresa. [Colunas](../supabase/01_schema.sql#L75) · [Grants](../supabase/05_production.sql#L38) · [Papéis e escopo](../supabase/27_effective_permissions.sql#L41) · [Leitura por papel](../supabase/27_effective_permissions.sql#L320) · [Hidratação](../src/services/supabaseService.ts#L370) · [RPC de perfil](../supabase/36_doctor_profile_access.sql#L103)

**Impacto.** Uma conta operacional pode receber dados pessoais além dos necessários para montar uma escala. A coleta no navegador amplia o volume de informações exposto quando uma conta é comprometida. Trata-se de acesso concedido pelas regras atuais, com risco de minimização. O achado não depende de cruzamento entre empresas por um usuário de tenant.

**Critério de aceite.** Definir campos necessários por finalidade. Restringir as colunas no banco e nas funções e conferir o resultado efetivo entregue ao navegador para cada papel, incluindo os perfis SaaS.

### NV-06 · Média · Documentos sem quarentena ou análise antimalware no fluxo

**Evidência.** O upload valida tamanho, extensão, MIME, assinatura inicial e terminador de PDF, JPEG ou PNG, e grava no bucket privado. Após a persistência, a rota autorizada pode emitir uma URL assinada para visualização ou download. O fluxo versionado não contém estado de quarentena nem exige resultado de análise antimalware. A migration 34 também admite originais de formatos Office, Pages e outros para download. [Validação de conteúdo](../src/lib/medicalFile.ts#L9) · [Disponibilização](../src/app/api/portal/documents/%5Bid%5D/route.ts#L28) · [Persistência](../src/app/api/portal/documents/%5Bid%5D/route.ts#L69) · [Originais importados](../supabase/34_imported_document_originals.sql#L4)

**Impacto.** Um arquivo que passe pela validação de formato pode conter conteúdo malicioso e ser aberto por um operador autorizado, inclusive durante a própria revisão do credenciamento. O impacto depende do arquivo e do leitor utilizado. O acesso privado reduz quem recebe o arquivo, e a mitigação de conteúdo depende de uma etapa independente de análise.

**Critério de aceite.** Manter novos arquivos indisponíveis para visualização e download até que uma análise de segurança os libere. Aplicar a mesma regra a originais importados e versões históricas, com registro de falha e de liberação.

### NV-07 · Média · Exclusão de empresa pode deixar documentos e contas residuais

**Evidência.** A RPC de exclusão lista os caminhos atuais de `medical_documents` antes de apagar os registros. Os caminhos de versões anteriores ficam no histórico, que possui chaves com exclusão em cascata. A rota tenta remover arquivos e contas Auth após a exclusão no banco e ignora os erros retornados por essas operações antes de devolver `deleted: true`. [Inventário e exclusão SQL](../supabase/09_admin_deletions.sql#L16) · [Histórico e cascata](../supabase/13_document_governance.sql#L47) · [Versões anteriores](../supabase/13_document_governance.sql#L101) · [Limpeza e resposta](../src/app/api/admin/organizations/route.ts#L35)

**Impacto.** Versões históricas podem permanecer no Storage sem ponteiro no banco. Uma falha retornada pelo Storage ou pelo Auth pode deixar arquivos, avatares ou contas residuais apesar da confirmação de sucesso. O achado afeta expurgo e rastreabilidade. Uma conta residual não implica autorização para consultar os dados de uma empresa excluída.

**Critério de aceite.** Registrar o inventário completo sob escopo da empresa antes de excluir referências. A limpeza deve manter estado persistente, permitir retomada e confirmar o sucesso apenas após reconciliar os objetos e as contas. Verificar em dados sintéticos com versões históricas e falhas simuladas de limpeza.

### NV-08 · Média · Upload de foto processa o corpo antes do limite e confia no MIME declarado

**Evidência.** `/api/profile` chama `request.formData()` antes de verificar o limite de 5 MB, que se aplica somente ao campo de avatar depois da leitura. O formato e a extensão armazenada são derivados de `File.type`, sem conferir a assinatura do conteúdo. A rota documental já usa leitura com limite e validação de assinatura. [Rota de perfil](../src/app/api/profile/route.ts#L14) · [Validação e upload](../src/app/api/profile/route.ts#L47) · [Controle na rota documental](../src/app/api/portal/documents/%5Bid%5D/route.ts#L49)

**Impacto.** Uma sessão autenticada pode obrigar o servidor a interpretar um corpo maior que o limite controlado pela rota e enviar conteúdo com MIME de imagem declarado. Restrições da hospedagem podem limitar o consumo máximo de recursos. Execução de conteúdo no navegador não foi demonstrada.

**Critério de aceite.** Aplicar um limite ao corpo antes da interpretação do formulário e validar o conteúdo da imagem no servidor antes de armazená-la. Verificar corpo acima do limite e incompatibilidade entre MIME declarado e formato real.

### NV-09 · Baixa · Instalador histórico inclui políticas públicas de leitura e escrita

**Evidência.** O instalador histórico concede acesso de leitura e escrita a `anon` e `authenticated` com condições irrestritas para tabelas centrais e políticas públicas no bucket de documentos. Os scripts `02` e `04` também contêm a configuração permissiva de origem. O roteiro identifica `init_all.sql` como histórico, e as etapas posteriores substituem as políticas antigas, restringem acessos e fecham o bucket. [Instalador histórico](../supabase/init_all.sql#L201) · [Políticas públicas do Storage](../supabase/04_storage.sql#L14) · [Substituição de políticas](../supabase/05_production.sql#L35) · [Storage restrito](../supabase/25_document_notification_rules.sql#L183) · [Roteiro do banco](../supabase/README.md)

**Impacto.** Usar o instalador histórico isoladamente em um projeto acessível com dados reais pode expor dados e permitir escrita anônima, com impacto crítico nesse cenário. O achado é um risco de provisionamento e não comprova a presença das políticas antigas no ambiente publicado.

**Critério de aceite.** Garantir que o caminho de instalação para ambientes acessíveis use a linha de base segura. A verificação de provisionamento deve identificar permissões anônimas inesperadas, bucket público ou migrations de endurecimento ausentes antes de carregar dados reais.

## Validação e limites da auditoria inicial

- **Testes locais.** Os 146 testes da suíte JavaScript passaram usando o script de ambiente local do projeto. A suíte SQL passou no PostgreSQL 16 descartável, com a linha de base, migrations 19 a 39 e verificações versionadas de Auth, Storage e RLS. As evidências dos achados são de revisão de código e configuração. [Suíte SQL](../scripts/test-database.ps1)
- **Segredos.** A busca dirigida por formatos comuns de chaves privadas, tokens de serviço, credenciais AWS/GitHub, conexões PostgreSQL com senha e JWTs não retornou correspondências nos 63 commits acessíveis examinados. A busca por padrões, inspirada no módulo de Gitleaks, tem cobertura parcial e exclui arquivos ignorados e configurações de ambiente.
- **Dependências.** O lockfile contém 77 entradas de produção, incluindo dependências opcionais de plataforma. As duas consultas de `npm audit`, com e sem dependências de desenvolvimento, foram concluídas no registro oficial do npm. Os avisos prioritários do fornecedor foram comparados com requisitos e recursos identificados no código.
- **Ambiente hospedado.** Configuração ativa de Auth, MFA, senhas, cabeçalhos HTTP no edge, alertas, permissões efetivas, versão publicada e retenção operacional permanecem fora das evidências desta revisão. Os registros de implantação serviram de contexto. Nenhuma alteração de código, configuração, dados ou dependências foi aplicada.
