# Preparação da homologação do NV Med

Este roteiro registra a estratégia anterior de projeto isolado. O piloto interno autorizado para preparação agora usa a infraestrutura existente. [Plano de implantação controlada](implantacao-controlada-nv-med.md)

Este roteiro começa após autorização para provisionar e aplicar as migrations no **Supabase independente de homologação**. Use somente organizações, usuários, plantões, pagamentos e arquivos sintéticos. Registre o projeto alvo, o commit candidato e quem aprova cada etapa. A auditoria anterior permanece como registro do ambiente observado. [Auditoria de prontidão](auditoria-prontidao-nv-med.md)

## Configuração do projeto

1. No Supabase, crie um projeto vazio com nome `NV Med Homologação`, região São Paulo e senha de banco própria. Confira custos e a organização proprietária antes de confirmar a criação. Compare o hostname do projeto com o inventário de produção por um canal administrativo. Guarde senha e chaves no cofre de homologação.
2. Reserve um hostname HTTPS estável para o Preview e ative a proteção de acesso da Vercel. Configure o `Site URL` do Auth com essa origem. Inclua na lista de redirects os caminhos exatos `/auth/confirm` e `/definir-senha` dessa origem. Para teste local autorizado, acrescente os mesmos caminhos em `http://localhost:3000`. A confirmação do portal pode incluir `?empresa=…`. Valide o link efetivamente gerado em cada fluxo, inclusive preservação da empresa. [Redirects do Supabase Auth](https://supabase.com/docs/guides/auth/redirect-urls)
3. Habilite Auth por e-mail com confirmação. Use SMTP de teste com destinatários controlados e modelos de confirmação, recuperação e convite apontando para o ambiente isolado. Cadastre contas sintéticas no domínio de teste com prefixo `nvmed-test-`. Depois da linha de base, vincule o primeiro usuário **já criado no Auth** ao perfil CEO de teste conforme `07_bootstrap_admin.sql`, revisando as duas constantes no SQL Editor do alvo. Trate os demais perfis pelo fluxo da aplicação.
4. A linha de base cria os buckets. Confirme que `medical-documents` e `profile-avatars` estão privados e vazios antes de subir arquivos sintéticos. Mantenha PDF, JPEG e PNG no bucket médico. A rota aceita um arquivo de até 4.000.000 bytes por requisição, limita a leitura do corpo e permite até 12 tentativas por conta em uma janela de 10 minutos.
5. Preencha as variáveis no escopo indicado, com a URL canônica do projeto. `NEXT_PUBLIC_SUPABASE_ANON_KEY` recebe a chave publicável ou `anon` legada. `SUPABASE_SERVICE_ROLE_KEY` recebe a chave secreta ou `service_role` legada e fica apenas no servidor. Mantenha a exposição das variáveis de sistema da Vercel habilitada para que a aplicação confira `VERCEL` e `VERCEL_ENV`. [Variáveis de sistema da Vercel](https://vercel.com/docs/environment-variables/system-environment-variables)

| Escopo | Configuração |
| --- | --- |
| Development | Copie [o modelo local](../.env.example) para `.env.development.local`. Deixe URL e chaves explicitamente vazias para trabalhar com o Supabase desativado. Para o Supabase local, use `localhost` ou `127.0.0.1`. Para o projeto isolado na nuvem, preencha também `NVMED_SUPABASE_HOMOLOGATION_HOST` com o hostname exato, sem protocolo. |
| Vercel Preview | Use [o modelo Preview](../config/environments/preview.env.example) e as chaves do projeto isolado. Defina as variáveis apenas em Preview e confira proteção e origem antes de compartilhar o build. |
| Vercel Production | [Modelo de referência](../config/environments/production.env.example) para uma janela futura autorizada. O código novo exige o escopo Production confirmado pela Vercel e o hostname de produção já registrado pela trava. |

O Next.js fixa as variáveis públicas no bundle no momento do build. A validação compara o escopo da Vercel, o hostname de homologação e a impressão digital do hostname de produção. No servidor, também compara o alvo em execução com o que foi validado no build. Troca de projeto exige novo build. `npm test` e `npm run build:local` executam com o Supabase desativado, mesmo se houver um `.env.local` legado. Variáveis de processo têm precedência sobre arquivos locais em `npm run dev`. A trava cobre os clientes e testes do repositório. Para SQL manual ou ferramentas externas, a confirmação do projeto no painel é obrigatória.

## Ordem de aplicação

1. No SQL Editor, confira novamente o projeto selecionado pelo hostname e pelo nome. Mantenha o Preview fechado e os buckets vazios durante a criação da base. Em um projeto vazio, use `01 → 02 → 04 → 05 → 06 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18`, um arquivo de cada vez. A 04 cria uma política histórica de Storage que a 05 substitui na mesma janela. Use a 07 apenas para o bootstrap revisto do administrador de teste. A carga 03 e o `init_all.sql` ficam fora dessa reconstrução. Em uma base existente, reconcilie catálogo e histórico antes de qualquer reaplicação.
2. Registre os hashes SHA-256 dos arquivos e o commit. Execute [a pré-verificação de leitura](../supabase/homologation.preflight.sql). Compare triggers, funções e políticas com a linha de base, incluindo qualquer view ou RPC extra com acesso a dados financeiros ou documentos. Investigue contagens de vínculos inválidos, colisões, pagamentos legados inconsistentes, caminhos fora da pasta e objetos ausentes. Faça o backup e confirme o plano de restauração antes de abrir a janela.
3. Aplique na ordem abaixo, com um resultado registrado por arquivo. Pare na primeira falha. Cada arquivo confirma sua própria transação. Se a sequência parar, identifique exatamente o que foi confirmado antes de preparar correção ou restauração.

| Ordem | Migration | Marco a conferir |
| --- | --- | --- |
| 19 | [Portal médico](../supabase/19_doctor_portal.sql) | Sessão validada por Auth, políticas restritivas, credenciamento e avisos. |
| 20 | [Oportunidades](../supabase/20_shift_opportunities.sql) | Candidaturas, histórico, concorrência e vínculos de escala. |
| 21 | [Presença](../supabase/21_shift_attendance.sql) | Registro e revisão de presença com acesso por papel. |
| 22 | [Pagamento](../supabase/22_payment_terms.sql) | Termos, vencimentos e auditoria financeira. |
| 23 | [Relatórios](../supabase/23_operational_reporting.sql) | Projeções e filtros financeiros separados por permissão. |
| 24 | [Permissões financeiras](../supabase/24_financial_data_access.sql) | Grants de tabela e coluna revisados, visão mascarada e escrita por RPC. |
| 25 | [Documentos e preferências](../supabase/25_document_notification_rules.sql) | Bucket médico fechado aos clientes, assinatura por vínculo e revisão, upload e limite de frequência. |

4. Execute [a pós-verificação de leitura](../supabase/homologation.postflight.sql). Confirme que o esquema, os papéis efetivos e o isolamento dos buckets correspondem ao candidato. Só então publique o build **Preview** correspondente, após autorização. As migrations 24 e 25 mudam o contrato de escala e documentos. A versão anterior falha com os novos privilégios. Mantenha aplicação e esquema na mesma janela.

## Verificação e ativação

Use `npm test`, `npm run lint`, `npx --no-install tsc --noEmit` e `npm run build:local`. No Windows, [o teste do banco](../scripts/test-database.ps1) usa binários PostgreSQL 16 e inicia um cluster novo, restrito a loopback, com identificadores aleatórios. A suíte aplica o esquema no laboratório, usa interfaces mínimas de Auth e Storage e descarta as escritas da suíte ao final. O teste para o servidor e conserva os arquivos sintéticos temporários para inspeção. [Fixture do laboratório](../supabase/lab.fixture.sql) · [Suíte SQL](../supabase/portal.verify.sql)

```powershell
pwsh -NoProfile -File .\scripts\test-database.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\16\bin'
```

Após autorização e preparação das fixtures, execute [a integração com Supabase](../scripts/homologation.integration.mjs) com `npm run test:homologation` em um processo com variáveis fornecidas pelo cofre. A suíte cria sessões de teste no Auth e verifica o Data API, RPCs e Storage. Ela exige `NVMED_RUN_HOMOLOGATION_TESTS=yes`, o hostname de homologação em `NVMED_SUPABASE_HOMOLOGATION_HOST` e em `NVMED_TEST_PROJECT_HOST`, a URL e a chave pública. A proteção recusa o hostname de produção antes de criar clientes.

- Use `NVMED_TEST_ORG_A`, `NVMED_TEST_ORG_B`, `NVMED_TEST_SHIFT_ID`, `NVMED_TEST_SHIFT_DATE`, `NVMED_TEST_DOCUMENT_ID`, `NVMED_TEST_DOCUMENT_PATH` e `NVMED_TEST_EMAIL_DOMAIN`. O plantão de A precisa de médico e valor combinado positivo. O documento precisa pertencer ao médico de teste de A e ter um objeto privado enviado pelo fluxo da aplicação.
- Defina `NVMED_TEST_<PAPEL>_EMAIL` e `NVMED_TEST_<PAPEL>_PASSWORD` para cada papel. Use `COORDINATOR` com leitura documental, `OPERATOR` Escalista, `VIEWER` Escalista com leitura financeira e documental adicional, `PHYSICIAN` aprovado e titular do documento, `TEMPORARY` com troca pendente e `INACTIVE` com perfil inativo no NV Med. Mantenha as contas de teste com e-mail confirmado.

| Cenário | Aprovação |
| --- | --- |
| Destino e Preview | Origem e chaves correspondem ao projeto isolado. A rede do navegador mostra só o hostname de homologação para Auth, Data API e Storage. Preview exige acesso de testador. |
| Troca de senha | Anônimo, perfil inativo, conta banida e JWT anterior ao reset falham nas APIs, Data API, RPCs e Storage protegido. Confirme também que o token antigo não altera a senha pela API do Auth. Apenas uma sessão criada há até 15 minutos consegue concluir a troca. Após a troca, somente nova sessão recupera as permissões e a recuperação por e-mail funciona. |
| Documento | Leitor autorizado abre a versão atual e, na equipe, a versão anterior pelo ID da auditoria. Outro tenant, outro médico, revisão de outro registro, caminho divergente e objeto ausente retornam 404. Médico inativo ou empresa suspensa perde o acesso do portal. O acesso documental da equipe segue o papel atribuído. |
| Storage e upload | Listagem, assinatura e URL pública direta do bucket médico falham. Upload válido retorna 201. Origem diferente, arquivo disfarçado, corpo acima do limite sem `Content-Length` e tentativa além da cota são rejeitados. Duas substituições simultâneas mantêm apenas uma atualização do registro, preservando o histórico. Teste URL de 60 s com navegador limpo e também após aquecer o cache. |
| Financeiro e exportações | Operador enxerga escala, mas campos financeiros da view e RPC ficam vazios. A tabela rejeita colunas financeiras e o filtro financeiro não revela contagens. Compare JSON, CSV e XLSX e confira que os dois arquivos omitem colunas e totalizações financeiras. Leitor autorizado lê sem baixar pagamentos. Editor autorizado consegue registrar a baixa dentro do próprio tenant. |
| Compatibilidade | Valide vaga, candidatura concorrente, presença, exceção manual, virada de dia, pagamentos legados, configuração documental, avatar e visualização administrativa. Confirme os bloqueios de alterações que apagariam histórico. |
| Recuperação | O ensaio restaura banco, usuários e objetos no mesmo ponto, comprova acesso com novo login e registra o tempo de recuperação observado. |

## Backup, restauração e riscos

1. Antes da aplicação, registre o horário do ponto de recuperação, o build compatível, o plano disponível e os responsáveis. Pause escritas durante a coleta coordenada. Gere dump lógico protegido de papéis personalizados, esquema e dados com o procedimento suportado pelo Supabase. Verifique separadamente usuários, identidades e extensões de Auth, incluindo `auth.users`, `auth.identities` e associação a `public.user_accounts`. Guarde a configuração de SMTP, provedores, redirects e segredos no cofre. Planeje novo login após restauração. [Backup e restauração pela CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
2. Exporte separadamente os binários dos buckets privados por API de Storage ou S3, incluindo versões históricas referenciadas. Registre em manifesto bucket, chave, tamanho e SHA-256. Faça restauração via API de Storage para que o serviço recrie metadados coerentes, respeitando o procedimento para esquemas gerenciados. O backup de banco sozinho cobre metadados, sem os binários dos objetos. [Backups do Supabase](https://supabase.com/docs/guides/platform/backups)
3. Restaure em alvo descartável autorizado e isolado. Compare contagens, referências, checksums e papéis. Verifique login e recuperação, leitura de PDF e imagens sintéticas, versões antigas, relatórios, RLS e operações de escala. Registre o ponto recuperável e o tempo medido antes de aceitar o plano.
4. Diante de falha parcial, feche o Preview para escrita e registre o último arquivo confirmado. Prefira correção revisada que preserve as restrições. Se for necessário restaurar, preserve e reconcilie as escritas posteriores ao backup, recupere PostgreSQL, Auth e Storage de forma coordenada e retome com o build que corresponde ao esquema restaurado.

Antes da publicação com dados reais, valide a varredura antimalware e quarentena, a retenção e a revisão de escopos administrativos. A URL assinada é um token portador. O bloqueio de acesso impede novas emissões, e links já emitidos ou cacheados podem continuar servindo por algum tempo. O TTL da assinatura e o cache de objetos antigos são independentes. Erros operacionais que dependem de vínculos ou de pagamentos podem indicar a presença de um bloqueio, mesmo com valores e estados financeiros fora da resposta. Esses cenários exigem validação no Supabase de homologação com a configuração real do Storage e perfis sintéticos. [Cache de URLs assinadas do Supabase](https://supabase.com/docs/guides/storage/cdn/smart-cdn)

## Arquivos desta preparação

| Área | Arquivos |
| --- | --- |
| Ambiente | `.env.example`, `config/environments/{preview,production}.env.example`, `next.config.ts`, `src/proxy.ts`, `src/lib/supabase/{environment,runtime,isConfigured,server,admin}.ts` |
| Sessões e APIs | `src/lib/supabase/authorizedUser.ts`, `src/lib/passwordLifecycle.ts` e os `route.ts` de `src/app/api/{account/password,admin/organizations,admin/users,admin/users/password,health,profile,reports/shifts,portal/documents/[id]}` |
| Documentos | `src/lib/documentAccess.ts`, `src/services/supabaseService.ts` e as páginas da pasta documental e do perfil médico em `src/app/(dashboard)` |
| SQL | Migrations 19, 20, 22, 23, 24 e 25. A sequência inclui a 21 existente. Scripts `supabase/{lab.fixture,portal.verify,homologation.preflight,homologation.postflight}.sql`. |
| Testes e operação | `package.json`, `scripts/{local-check.mjs,supabaseSecurity.test.mjs,password-lifecycle.test.mjs,test-database.ps1,homologation.integration.mjs}`, `README.md`, `supabase/README.md` e este roteiro |
