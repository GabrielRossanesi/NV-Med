# Correção do carregamento do painel — 16/11/2026

Após a importação, o painel autenticava o usuário, mas falhava ao carregar
`nv_staff_shifts`. A consulta inicial de 500 linhas foi reproduzida com uma
sessão administrativa existente e o limite de oito segundos da API: o
PostgreSQL cancelou a operação por `statement_timeout` durante as verificações
de permissão financeira.

A view repetia as verificações de acesso por plantão e novamente para cada um
dos oito campos financeiros. A validação anterior da importação conferiu as
tabelas de origem e não identificou esse gargalo da leitura autenticada.

## Correção aplicada

A [migration 33](../supabase/33_staff_shift_read_performance.sql) calcula os
acessos uma vez por empresa, em um CTE `MATERIALIZED`, e reutiliza essas decisões
na seleção das linhas e nas máscaras financeiras. Cada consulta continua
avaliando a sessão atual. Não há cache de permissões entre sessões.

Foram preservados os nomes, a ordem e os tipos das colunas, os grants da view,
`security_barrier=true`, as funções de autorização e as políticas RLS. Nenhum
cadastro, documento, plantão ou usuário Auth foi alterado pela correção. A view
original e suas permissões foram guardadas no pacote privado de execução para
permitir reversão.

O uso de materialização evita avaliações repetidas da expressão, conforme a
[documentação do PostgreSQL 17](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION).
A substituição preserva as propriedades existentes da view, conforme
[CREATE VIEW](https://www.postgresql.org/docs/17/sql-createview.html).

## Evidências

- Antes: cancelamento da consulta de 500 plantões ao atingir oito segundos.
- Depois, em produção: 500 plantões em 33,191 ms, no mesmo contexto de acesso.
- A segunda página, com 447 plantões, também passou no limite da API.
- Nove perfis com sessões existentes foram verificados em transações
  descartáveis: amostras da consulta original, visibilidade completa por empresa,
  máscaras financeiras e negativa de identidade sem autenticação.
- Todas as demais consultas de inicialização passaram, incluindo as três
  páginas de documentos e o histórico documental.
- O operador confirmou que o painel voltou a abrir após a aplicação.

As medições são do tempo de execução SQL no momento da verificação; não são
uma garantia de tempo total da interface. A correção foi aplicada diretamente
ao Supabase e não exigiu uma nova publicação da aplicação na Vercel.

O roteiro `scripts/test-database.ps1` aplica agora a migration 33 no laboratório
local e repete a verificação bancária compatível com o esquema atual. O teste
`staff-shift-read-performance.verify.sql` acrescenta mil postos sintéticos com
rollback e verifica a paginação de 500 registros, máscaras financeiras e
negativas de outra empresa, de médico do portal e de identidade ausente.
