# Otimização de documentos e armazenamento

## Arquitetura e escopo

| Fluxo | Onde grava | Referências e acesso |
| --- | --- | --- |
| Cadastro, ficha do médico, pasta administrativa e Portal Médico | `POST /api/portal/documents/:id`, bucket privado `medical-documents` | `medical_documents.file_path`, `file_name`, revisões em `document_audit_logs.changes.filePath` e `previousFilePath`. Cada caminho contém empresa, médico e objeto. O cadastro cria os requisitos no banco antes do envio. |
| Originais importados | `medical-documents` | A migration 34 preserva, entre outros, DOC, DOCX, HEIF, Pages e MHT. A rota entrega formatos sem prévia como anexo. |
| Foto de perfil | `POST /api/profile`, bucket `profile-avatars` | `user_accounts.avatar`. O fluxo já usa Sharp para validar e reduzir a imagem do avatar. |
| Comprovantes financeiros | `finance-receipts` | Upload do financeiro com regras próprias de vínculo e acesso. Os comprovantes preservam seus bytes por finalidade documental. |

Antes da mudança, a rota médica aceitava PDF, JPEG e PNG e gravava o arquivo enviado. As novas versões mantêm o histórico e passam pela análise documental existente. A leitura usa a mesma rota autenticada, que consulta o escopo no banco antes de emitir uma URL de 60 segundos. O bucket médico permanece privado e o navegador continua sem escrita direta nele.

## Novos envios

O serviço compartilhado `sendMedicalDocument` atende a ficha, a pasta administrativa e o Portal. O formulário de cadastro oferece **Salvar e enviar documentos** quando o perfil tem permissão de editar documentos. O operador pode escolher **Manter arquivo original**, inclusive quando uma norma exige a preservação dos bytes de uma imagem. O servidor higieniza o nome e grava cada novo envio em um caminho único com `upsert: false`.

- JPEG e PNG compatíveis são comparados com WebP de qualidade 90 em um Web Worker do navegador. A estratégia e os limites ficam em `src/lib/medicalFile.ts`. O worker aplica a orientação EXIF, mantém dimensões e compara transparência e luminância em blocos. A versão convertida precisa ser menor e respeitar os limites de diferença.
- O maior lado para conversão é 2.560 px. Imagens acima desse tamanho seguem com a resolução original se couberem no limite de envio e passarem na validação. A redução de resolução fica suspensa até haver evidência de equivalência em documentos representativos. Imagens com marcadores de procedência, XMP, perfis de cor sinalizados, PNG animado ou profundidade de 16 bits ficam fora da conversão. A identificação de metadados de integridade é conservadora e o controle de preservação permanece disponível para requisitos que o formato não sinaliza.
- O arquivo final tem limite de 4.000.000 bytes. JPEG e PNG podem entrar na tentativa local com até 12.000.000 bytes. A imagem armazenada precisa ficar dentro de 8.192 px por lado e 24 milhões de pixels, em uma única imagem. O worker é encerrado após 8 segundos. Quando a conversão falha, o original continua elegível se estiver dentro dos limites.
- O backend confere extensão, MIME, assinatura e o arquivo decodificado por Sharp. O WebP existente passa pela mesma validação de imagem e é gravado sem nova compressão. O processamento local e a validação de formato não fazem análise antimalware.
- PDFs seguem integrais, inclusive os digitalizados. A inspeção limitada identifica marcadores visíveis de assinatura, certificação, restrição por assinatura ou criptografia. Ela não autentica certificados nem encontra necessariamente marcadores em fluxos comprimidos. Regravar imagens em PDFs sem verificação estruturada pode invalidar assinaturas, formulários, anexos e textos. A recompressão de PDF fica desativada nesta estratégia.
- Os metadados de novos WebP guardam versão da estratégia, formato e tamanho anterior declarados pelo navegador. O catálogo já mantém formato, tamanho final e data do objeto. O nome usado pela aplicação tem a extensão final. O tamanho anterior medido fora do servidor só alimenta a economia estimada. Os hashes do acervo ficam no manifesto de troca, que já é exigido para recuperação.

O limite HTTP preserva margem para o formulário abaixo do teto padrão da Vercel. A conversão usa Canvas/OffscreenCanvas local e o backend usa o Sharp existente. Sem dependências novas, APIs de conversão externas ou infraestrutura adicional. [Limites das Vercel Functions](https://vercel.com/docs/functions/limitations)

## Acervo existente

Configure as variáveis locais de acesso por cofre. `NVMED_STORAGE_PROJECT` e `NVMED_STORAGE_URL` identificam o projeto. `NVMED_STORAGE_SERVICE_KEY` deve ficar no processo administrativo. Configure `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=verify-full` e `PGSSLROOTCERT` para o pooler de sessão. Se necessário informe o executável em `NVMED_STORAGE_PSQL`. Use Node 24 ou superior. O laboratório aceita `NVMED_STORAGE_PROJECT=local` com endpoint em loopback.

```powershell
node scripts/medical-storage.mjs dry-run --sample 12 --pdf-sample 8 --limit-bytes 1000000000
```

O dry-run usa transações SQL `READ ONLY` e baixa apenas amostras para a memória. O download da amostra usa a franquia de tráfego do projeto. O inventário inclui todos os buckets do catálogo, os objetos, o consumo por formato e empresa quando identificável e possíveis órfãos médicos e de avatar. Comprovantes e outros buckets entram nos totais e ficam fora da classificação de órfãos. Os maiores objetos e possíveis órfãos são apresentados por identificadores derivados. A projeção pondera o ganho medido por formato em bytes. Ela depende da cobertura da amostra, das referências verificáveis e da revisão de equivalência. A projeção fica indisponível se houver URLs legadas sem reconciliação e quando nenhum candidato pôde ser amostrado. Possíveis órfãos são apenas um diagnóstico.

Para revisar uma imagem, use o identificador da amostra. A prévia fica cinco minutos em loopback, sem gravação em disco. Compare textos pequenos, CRM, RQE, CPF, RG, assinaturas, carimbos, transparência e leitura de QR/código de barras. Confirme a finalidade documental e a autorização antes de aceitar os hashes. O acervo usa WebP sem perdas para PNG e qualidade 90 para JPEG aprovado individualmente.

```powershell
node scripts/medical-storage.mjs review --confirm-project <projeto> --candidate-id <identificador>
```

O manifesto aprovado contém `project`, `strategy` igual a `legacy-webp-v1` e `files`, com `id`, `originalSha256` e `optimizedSha256` em cada item. O operador deve ter autorização explícita para os arquivos enumerados depois da apresentação do dry-run. Em produção, confira primeiro a aplicação com suporte a WebP e a migration 57. `NVMED_STORAGE_BACKUP_KEY` recebe 32 bytes em Base64 guardados no cofre, separados do diretório de backup. Crie um diretório com acesso restrito fora dos repositórios e pastas públicas.

```powershell
node scripts/medical-storage.mjs apply --confirm-project <projeto> --approved-manifest <manifesto.json> --backup-dir <diretorio> --batch-size 3 --limit-bytes 1000000000
```

O processo mantém um bloqueio consultivo na sessão PostgreSQL e usa um destino determinístico por par de hashes. Antes da troca, guarda os bytes e as referências atuais e históricas em um pacote AES-256-GCM. O pacote é relido e validado por SHA-256. A ferramenta checa espaço para coexistência temporária, valida o hash e o MIME pelos endpoints de prévia e download autenticados por URL assinada e troca a resolução do caminho físico. A tabela privada `medical_storage_replacements` registra ambos os caminhos, empresa, médico, tamanhos, hashes, estratégia e horário. O documento e as entradas de auditoria mantêm data, aprovação, versão e referências históricas. Depois de dois minutos, a próxima execução revalida escopo e hash antes da remoção pelo Storage API. `Ctrl+C` interrompe entre itens ou deixa uma operação em ponto retomável. Executar novamente com o mesmo manifesto e diretório reconcilia objetos enviados antes de uma interrupção. O acervo permanece fora do lote se a quarentena estiver ativa ou se houver referências legadas não reconciliadas.

### Restauração

Conserve o manifesto aprovado, os backups cifrados e a chave de recuperação. Execute `rollback` com os mesmos argumentos e lotes após confirmar o espaço para restaurar o original. O script verifica o SHA-256 de origem, reinsere o objeto se estiver ausente, valida a URL assinada e desfaz a resolução para WebP. Uma nova execução após dois minutos reconcilia e remove a cópia WebP quando nenhuma referência direta a utiliza. Em caso de erro, inspecione as permissões e espaço e retome com o mesmo manifesto. Os estados e resultados individuais são registrados no diário local cifrado. Mantenha a versão da aplicação capaz de abrir WebP enquanto existirem uploads nesse formato. [Procedimentos de backup do NV Med](backup-restauracao-nv-med.md)

## Monitoramento SaaS

A migration 58 registra o estado agregado em uma tabela com RLS e acesso fechado aos clientes. Apenas uma conta SaaS ativa pode consultar a RPC. A atualização usa `pg_cron` a cada 30 minutos. Quando o cache vence, a primeira consulta também pode atualizá-lo. A atualização manual reaproveita resultados do último minuto. O lock transacional evita recalcular simultaneamente e preserva a deduplicação dos alertas. As notificações são pessoais e entram na central já existente quando o nível aumenta. As faixas são Normal abaixo de 70%, Atenção a partir de 70%, Alerta a partir de 85%, Crítico a partir de 95% e Limite atingido a partir de 100%.

O limite vem de `public.storage_usage_snapshot.limit_bytes`. O valor inicial é 1.000.000.000 bytes e o DBA pode configurá-lo na linha única. A CLI lê essa configuração quando a migration 58 existe e aceita `--limit-bytes` para simular outro limite. A soma usa o tamanho registrado em `storage.objects` no projeto atual. O painel sinaliza objetos sem tamanho informado e distingue economia estimada dos novos envios e economia física confirmada no acervo. A quota e a cobrança do Supabase agregam o consumo entre projetos da organização e consideram a média do período de faturamento em GB-horas. O valor do painel representa o catálogo no momento da coleta. [Storage Size no Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size) · [Limites e faturamento do Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)

## Ativação e verificações

| Etapa | Pré-requisito de ativação |
| --- | --- |
| Novos uploads | Migration 56 antes da versão que envia WebP. Smoke test com PNG ou JPEG convertido, PDF intacto, histórico, permissões e download. |
| Acervo | Migrations 56 e 57 e aplicação WebP ativa. Dry-run e revisão do manifesto antes de qualquer operação de escrita. |
| Painel SaaS | Migrations 56 a 58 e `storage-usage-cron.setup.sql`. Compare a resposta agregada com o painel do Supabase e confira os destinatários da central. |

Os testes locais estão em `scripts/medicalFile.test.mjs`, `scripts/medical-upload.browser.mjs` e `supabase/storage-usage.verify.sql`. Execute `npm test`, `npm run lint`, `npx tsc --noEmit`, o build e o laboratório `scripts/test-database.ps1`. A suíte de navegador usa a aplicação real com dados sintéticos e um serviço em loopback para Auth, dados e Storage. Qualidade fotográfica e leitura de códigos em documentos reais exigem validação em amostra autorizada.

### Resultado da validação local

- A suíte automatizada passou com 182 testes. O laboratório PostgreSQL passou pelas migrations 56 a 58, permissões, alertas, backup íntegro, interrupção no envio, retomada e restauração.
- No Edge, passaram o envio administrativo e pelo Portal, a substituição, a falha de rede seguida de nova tentativa, a preservação do original e de WebP existente, a prévia e o download. A conversão preservou os módulos do QR sintético no centro de cada célula. O painel coube em 1440, 390 e 360 px.
- O dry-run sintético converteu um PNG de 38.622 bytes para um WebP de 44 bytes. O arquivo de teste tem cor uniforme e serve para exercitar a medição e o rollback. A estimativa de produção depende da composição do acervo real.
- Lint, TypeScript e build Webpack passaram. O build padrão Turbopack falhou localmente no Windows ao iniciar o processo de PostCSS para `Account.module.css`.

### Dry-runs autorizados em produção

Em 26/11/2026, o catálogo registrou 881 arquivos e 796,86 MB. Os 584 PDFs somavam 729,43 MB. A amostra de JPEG e PNG do acervo apontou uma economia projetada de 500 KB com a estratégia entregue nesta versão.

O ensaio separado de PDF estimou 88,78 MB de economia sem perdas nos arquivos de até 10 MB com base na amostragem. Nos 12 PDFs acima de 10 MB, a economia medida foi de 5,88 MB. Seis dos oito digitalizados tiveram ganho, com estrutura, pixels das imagens e renderização de dez páginas conferidos em MuPDF e Poppler. Somar os dois recortes indica uma economia preliminar de 94,66 MB e um uso projetado de 702,20 MB. Essa projeção não inclui a economia de JPEG/PNG. Os ensaios ocorreram em memória e a compressão de PDFs segue fora da rotina de produção desta versão.

## Arquivos da entrega

| Área | Criados | Alterados |
| --- | --- | --- |
| Upload e entrega | `src/components/MedicalDocumentUpload.tsx`, `src/lib/medicalUpload.ts`, `medicalImageClient.ts`, `medicalImage.worker.ts`, `medicalImageValidation.ts` | `src/lib/medicalFile.ts`, `documentAccess.ts`, `src/app/api/portal/documents/[id]/route.ts`, `src/services/supabaseService.ts`, `src/store/useStore.ts`, páginas de cadastro, ficha e pasta do médico, `src/app/portal/PortalHome.tsx` |
| Acervo | `scripts/medical-storage.mjs`, `medical-storage-db.mjs`, `medical-storage-media.mjs`, `medical-storage-backup.mjs` | — |
| Painel SaaS | `src/components/StorageUsagePanel.tsx`, `src/lib/storageUsage.ts` | Página `/admin` e `src/components/NotificationInbox.tsx` |
| Banco | Migrations 56, 57, 58 e `supabase/storage-usage-cron.setup.sql` | `supabase/README.md` |
| Testes | `scripts/medical-upload.browser.mjs`, `scripts/medical-storage.lab.mjs`, `supabase/storage-usage.verify.sql` | `scripts/medicalFile.test.mjs`, `scripts/test-database.ps1`, `supabase/lab.fixture.sql` |
| Guia | `docs/otimizacao-documentos.md` | `AGENTS.md` |
