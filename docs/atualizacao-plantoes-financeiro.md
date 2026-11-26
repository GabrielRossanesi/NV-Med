# Atualização de plantões e financeiro empresarial

## Escopo e componentes

| Migration | Escopo |
| --- | --- |
| `48_shift_approval.sql` | Origem da aprovação, fuso da unidade, edição retroativa, histórico e rotina de expiração |
| `49_shift_cash_payments.sql` | Transferências parciais, comprovantes, estornos e saldo da obrigação PJ |
| `50_company_billing.sql` | Contratantes, contratos, vigências, apuração, faturamento, repasses e fechamento |
| `51_finance_overview_and_exports.sql` | Indicadores por regime, consultas e permissões de exportação, saldos nos relatórios existentes |

As rotas em `src/app/(dashboard)/financeiro`, `src/components/finance` e `src/app/api/reports` integram as novas áreas com o financeiro existente. As fichas de escala e Portal Médico exibem a origem da aprovação. As fichas de unidade permitem configurar o fuso para novos registros.

`escala.approve_shift` autoriza aprovação pelo administrativo e `escala.edit_past` autoriza a edição retroativa elegível. Ambas exigem edição de escalas. O registro e o estorno médico usam a edição financeira e, para estorno, a edição de configurações. As novas ações empresariais são `financeiro.rates_view`, `rates_edit`, `billing_view`, `billing_manage`, `receipt`, `adjustment`, `period_close`, `period_reopen` e `export`. Repasses consolidados aparecem por contratante, contrato, unidade e setor. Filtros por médico ou especialidade mantêm os valores de plantão e ocultam repasses agregados que não têm rateio comprovado.

A visão por competência usa meses completos e vincula os repasses à competência de faturamento. Caixa usa a data das movimentações registradas. A margem bruta fica indefinida para receita zero. Nas planilhas, as linhas de totais mantêm grupos, valores em centavos e IDs de conferência. A exportação permite até 366 dias e 10.000 registros. Valores históricos sem data de baixa disponível ficam na visão por competência.

Leia também [aprovação e histórico](aprovacao-plantao.md), [pagamentos médicos](pagamentos-plantao.md) e [faturamento empresarial](faturamento-empresarial.md).

## Homologação e produção

1. Confirme o projeto de destino e o histórico de migrations. Faça backup verificável e execute `finance-evolution.preflight.sql` em uma sessão de leitura com acesso ao catálogo. Revise volume de plantões expirados, pagamentos parciais, datas de baixa e disponibilidade do pg_cron. A consolidação usa PostgreSQL 15 ou superior.
2. Reconstitua o laboratório com `scripts/test-database.ps1` e passe os testes da 48 à 51. Use um projeto Supabase isolado para conferir Auth, Storage, permissões por perfil e upload/abertura de comprovantes. Compare os totais do período de referência com os saldos atuais.
3. Em uma janela autorizada, aplique as migrations na ordem e publique a aplicação correspondente. Os índices novos podem bloquear gravações nas respectivas tabelas durante sua criação. Monitore tempo de aplicação e contenção.
4. Confirme os fusos das unidades, os cargos com permissão de aprovar, editar e exportar e os valores contratuais de homologação. Regularize plantões históricos caso a caso a partir do contrato e da apuração comprovados.
5. Aplique a migration 52 e ative `shift-approval-cron.setup.sql`. A primeira ativação grava o corte no banco e o job considera apenas os plantões que encerrarem depois desse horário. O job processa até 200 por execução, de cinco em cinco minutos. A execução regular consulta um índice parcial de pendências. Caso a fila seja grande, acompanhe a duração e os erros do job até o escoamento.
6. Monitore o volume de comprovantes, o tempo das consultas empresariais, os estornos e a diferença de saldos em cada fechamento. Suspenda o job se necessário e mantenha as migrations aditivas para preservar os registros gerados. Faça reversão de lançamentos pelo fluxo auditado.

A infraestrutura continua em Vercel e Supabase. O impacto esperado é um job SQL a cada cinco minutos, armazenamento de comprovantes e crescimento proporcional ao número de plantões faturados e movimentações. A primeira execução pode consumir vários lotes conforme o estoque de pendências. A emissão fiscal continua no processo externo. A apuração e a aprovação precisam de evidências próprias. A verificação local não inclui o pg_cron ou o Storage gerenciado do projeto de produção.

## Arquivos da entrega

### Documentação

- `docs/aprovacao-plantao.md`
- `docs/atualizacao-plantoes-financeiro.md`
- `docs/faturamento-empresarial.md`
- `docs/pagamentos-plantao.md`

### Testes locais

- `scripts/company-finance.test.mjs`
- `scripts/test-database.ps1`

### Aplicação

- `src/app/(dashboard)/escala/page.tsx`
- `src/app/(dashboard)/financeiro/empresa/page.tsx`
- `src/app/(dashboard)/financeiro/page.tsx`
- `src/app/(dashboard)/financeiro/relatorio/page.tsx`
- `src/app/(dashboard)/relatorios/plantoes/ShiftReportPage.tsx`
- `src/app/(dashboard)/unidades/[id]/page.tsx`
- `src/app/api/reports/company-finance/route.ts`
- `src/app/api/reports/shifts/route.ts`
- `src/app/portal/PortalSchedule.tsx`
- `src/components/finance/BillingActionDialog.tsx`
- `src/components/finance/BillingNav.tsx`
- `src/components/finance/BillingOverview.tsx`
- `src/components/finance/BillingRates.tsx`
- `src/components/finance/CompanyFinance.tsx`
- `src/components/schedule/ScheduleHistory.tsx`
- `src/components/schedule/ShiftApprovalDialog.tsx`
- `src/components/schedule/ShiftCashPaymentFields.tsx`
- `src/components/schedule/ShiftFinancialDetails.tsx`
- `src/components/schedule/ShiftPaymentMovements.tsx`
- `src/components/schedule/ShiftRecordSummary.tsx`
- `src/components/schedule/UnitTimeZone.tsx`
- `src/lib/companyBilling.ts`
- `src/lib/companyFinanceExport.ts`
- `src/lib/companyFinanceReport.ts`
- `src/lib/dashboardOverview.ts`
- `src/lib/financeState.ts`
- `src/lib/notifications.ts`
- `src/lib/permissions.ts`
- `src/lib/scheduleAudit.ts`
- `src/lib/shiftApproval.ts`
- `src/lib/shiftCashPayment.ts`
- `src/services/supabaseService.ts`
- `src/store/useStore.ts`
- `src/types/index.ts`

### Banco de dados

- `supabase/48_shift_approval.sql`
- `supabase/49_shift_cash_payments.sql`
- `supabase/50_company_billing.sql`
- `supabase/51_finance_overview_and_exports.sql`
- `supabase/company-billing.verify.sql`
- `supabase/finance-evolution.preflight.sql`
- `supabase/finance-overview.verify.sql`
- `supabase/shift-approval-concurrency.verify.sql`
- `supabase/shift-approval-cron.setup.sql`
- `supabase/shift-approval.verify.sql`
- `supabase/shift-cash-payment.verify.sql`
