# Setores e especialidades

Implementação incremental sobre os módulos existentes. `sectors.primary_specialty` define a especialidade de novos plantões; `sectors.specialties` conserva os relacionamentos legados. O catálogo continua sendo `organizations.settings.specialties`, limitado pelas autorizações da unidade. A migration não preenche vínculos por nome nem cadastra exemplos.

Em Configurações da empresa → Setores e Especialidades, filtre a unidade e crie ou edite um setor. O mesmo editor permanece disponível na unidade e no cadastro da escala. Nome, descrição, situação, cobertura e referências financeiras continuam disponíveis. Criar e editar dependem das ações individuais do módulo Unidades e setores; RLS e o RPC financeiro preservam essas restrições no servidor.

Na escala, a sequência é Unidade → Setor → Especialidade → Médico. A especialidade vinculada aparece somente para leitura. A lista de médicos usa `nv_eligible_shift_doctors`, que consulta credenciamento aprovado, especialidades aprovadas, situação ativa, vínculo com empresa/unidade, política documental e conflitos no horário proposto. O texto livre de especialidade do médico não comprova elegibilidade. Trocar o setor preserva os outros campos e revalida o médico. A consulta falha de forma restritiva e permite tentar novamente; vagas podem permanecer abertas conforme as permissões de criar/editar escalas.

As atribuições são revalidadas por trigger, incluindo aprovações de candidaturas e substituições. Os fluxos existentes de vagas e trocas utilizam a mesma função de credenciamento. Credenciamentos legados pendentes ou ausentes passam a exigir aprovação estruturada para novas atribuições. Plantões antigos não são reescritos. Edições sem mudança de responsável, escopo ou horário conservam a atribuição existente.

Alterar a especialidade principal fica bloqueado enquanto houver plantões futuros ou em andamento com outra especialidade. A interface identifica as ocorrências carregadas, e o banco verifica todas as ocorrências e retorna a quantidade impeditiva. A equipe deve regularizar as escalas, candidaturas e trocas pelo fluxo existente antes de repetir a alteração. Não há atualização em massa automática. A tabela `sector_specialty_history` registra usuário, instante, especialidade anterior e nova; sua leitura respeita empresa e permissão de visualizar unidades. Plantões concluídos ou históricos mantêm a especialidade registrada e não permitem substituí-la.

Plantões avulsos vinculados a setor utilizam sua especialidade principal. Avulsos sem setor permitem selecionar uma especialidade autorizada da empresa/unidade. Modalidades PJ, CLT e PREFEITURA continuam utilizando os serviços financeiros existentes.

## Implantação e registros legados

1. Revisar e aplicar, com autorização explícita, `supabase/31_sector_primary_specialty.sql` após a migration 30, primeiro em homologação. O código depende desse contrato de banco.
2. Inventariar pendências com a consulta abaixo, usando um acesso administrativo autorizado. Não atribuir especialidades por comparação de nomes.
3. Vincular cada setor pelo editor, após validação administrativa. Setores com ocorrências futuras divergentes exigem regularização operacional prévia. Conferir também credenciamentos estruturados dos profissionais legados.
4. Homologar os perfis reais e os temas claro/escuro em telas móveis e desktop. Autorizar a implantação da aplicação separadamente.

```sql
SELECT organization_id, unit_id, id, name, specialties
FROM public.sectors
WHERE primary_specialty IS NULL
ORDER BY organization_id, unit_id, name;
```

A implementação inicial foi validada localmente. A migration e a publicação foram realizadas posteriormente, após autorização explícita, conforme o registro abaixo.

## Arquivos

- `src/app/(dashboard)/configuracoes/page.tsx`: seção de setores na configuração da empresa.
- `src/components/schedule/SectorSettings.tsx`: listagem, filtros e ações de configuração.
- `src/components/schedule/SectorEditorDialog.tsx`: especialidade principal, vínculos legados e bloqueio de ocorrências futuras.
- `src/app/(dashboard)/unidades/[id]/page.tsx`: indicação da especialidade principal e pendências.
- `src/app/(dashboard)/escala/page.tsx`: preenchimento automático, consulta de elegibilidade e preservação do formulário.
- `src/lib/sectorSpecialties.ts`: transições de setor e revalidação do médico.
- `src/services/supabaseService.ts` e `src/types/index.ts`: persistência e tipagem do novo campo.
- `supabase/31_sector_primary_specialty.sql`: schema, auditoria, validações, consulta de elegibilidade e compatibilidade com avulsos e preços.
- `supabase/sector-primary-specialty.verify.sql`: testes SQL do novo contrato.
- `scripts/sectorSpecialties.test.mjs` e `scripts/test-database.ps1`: testes do formulário e inclusão da migration no laboratório.
- `supabase/README.md` e este documento: operação e implantação.

## Verificação local

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run build:local
pwsh -NoProfile -File scripts/test-database.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\16\bin'
```

O laboratório usa dados sintéticos, um cluster novo em loopback e encerra o servidor no final. A suíte anterior roda antes da 31; `supabase/sector-primary-specialty.verify.sql` verifica o novo contrato após a migration, incluindo RLS, múltiplas especialidades, bloqueios documentais, candidaturas, revalidação de substituições e histórico. Os testes de formulário em `scripts/sectorSpecialties.test.mjs` verificam a transição de setor e preservação dos demais dados.

## Implantação autorizada em 11/11/2026

- Supabase: NV Med / NV Core, projeto `racllaysakzbdbjngiby`, branch `main` de produção. Preflight confirmou as migrations 28–30 e ausência da 31.
- Migration: `31_sector_primary_specialty.sql`, SHA-256 `4685D119044D4AB0478B380C92DD34D1587543E38AF53AD3BA3BCEB69A2A2632`.
- Aplicação pelo SQL Editor autenticado às **13h35min20s (America/Sao_Paulo)**. O arquivo foi importado diretamente de uma cópia local UTF-8 e conferido integralmente antes da execução.
- Uma única transação bloqueou brevemente as tabelas afetadas e comparou contagens e hashes de todas as colunas preexistentes em `sectors` e `shifts`. As conferências passaram antes do COMMIT: **5 setores e 1 plantão preservados integralmente**. Nenhuma especialidade foi inferida, e nenhuma linha de auditoria foi inventada.
- Postflight às **13h37min31s** confirmou as **11 definições de funções idênticas ao arquivo local**, os 3 novos triggers ativos, RLS e política de leitura da auditoria. `anon` não pode executar a consulta de elegibilidade nem ler a auditoria; `authenticated` não pode atualizar a auditoria e pode chamar o RPC autorizado.
- Vercel: candidato de produção criado com `--skip-domain`, compilação e TypeScript concluídos no ambiente hospedado, seguido da promoção do ID exato `dpl_CYZn7z2HQtj8jqGCpHSe61gqih9h`.
- [Deploy publicado](https://vercel.com/gabrielrossanesis-projects/nvmed/CYZn7z2HQtj8jqGCpHSe61gqih9h) · [Aplicação](https://med.nvcore.com.br) · [Configuração de setores](https://med.nvcore.com.br/configuracoes#setores-especialidades).
- Deploy anterior registrado para rastreabilidade: `dpl_N39DQC4M9qyEC4VWrrKkC8HJbkAP`. Não reverter a aplicação sem conferir sua compatibilidade com o novo contrato de banco.
- A interface autenticada publicada exibiu a seção **Setores e Especialidades** e os vínculos pendentes. Os **5 setores** existentes continuam sem especialidade principal e exigem configuração administrativa antes de novos plantões associados. Não foram alterados dados operacionais para testar o fluxo.

A execução utilizou as sessões normais já autenticadas do painel Supabase e da CLI Vercel. Não houve rotação de credenciais, alterações de Auth, mudanças no Storage ou concessões administrativas adicionais.

Smoke HTTPS após a promoção: `/login` retornou 200; `/configuracoes` sem sessão redirecionou para `/login` (307); `/portal` retornou a entrada pública prevista, com link de login (200); `/api/health` sem sessão recusou acesso (401). A página autenticada de Configurações carregou o novo componente e os dados existentes.
