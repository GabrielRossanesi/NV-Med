# Correção da abertura do perfil médico

## Falha e causa

Em 26/11/2026, foi reproduzida a falha ao clicar em **Editar perfil**: a página era substituída pelo erro global do Next.js. O console confirmou `TypeError: Cannot read properties of null (reading 'replace')` no tratamento de endereço.

O Supabase permite endereço nulo nos cadastros importados. O valor padrão do parâmetro React tratava somente `undefined`, e `parseDoctorAddress` chamava `replace` diretamente. A abertura do formulário podia falhar antes de qualquer edição ou gravação.

## Correção

`parseDoctorAddress` aceita `null` e `undefined` como ausência de endereço. `DoctorAddressFields` normaliza esse valor ao iniciar os campos estruturados e o endereço livre. Endereços legados continuam preservados. Não é necessária uma limpeza de dados nem uma migration.

O teste de navegador usa um perfil fictício com endereço, CPF, telefone e e-mail nulos. Confirma que o formulário abre, alterna para endereço livre e cancela sem gravar. Também altera somente o telefone fictício, verifica a persistência após recarga e confirma que o endereço permanece nulo.

## Consolidação das pendências

As alterações locais foram registradas e integradas à revisão `9db3f03`, confirmada no domínio de produção antes da publicação. Foram preservadas as melhorias de nomes médicos, conta, status, confirmações, financeiro e cobertura interativa já publicadas. Também foram versionados o endurecimento do provisionamento, as verificações de segurança e os relatórios que estavam pendentes.

A antiga cópia local `52_fractional_coverage.sql` foi consolidada no nome já publicado `53_fractional_coverage.sql`, com conteúdo idêntico. O arquivo `53_doctor_status.sql` continua independente. A suíte SQL reúne as verificações de segurança e as migrations até a 55 na ordem das dependências.

O cache `supabase/.temp` permanece fora do Git. O diretório privado `Import`, assim como os artefatos `.vercel`, fica fora do lint e do deploy; o código da aplicação e os scripts versionados continuam verificados. Nenhuma credencial ou evidência privada foi incluída nos commits.

## Validações

- 177 testes de aplicação aprovados, incluindo a regressão de endereço ausente.
- 21 verificações de navegador aprovadas, com interface real e APIs fictícias restritas a loopback; incluem perfis sem endereço, persistência, cancelamento e erros de carregamento sem derrubar a página.
- 9 fluxos do editor de cobertura aprovados no navegador local.
- Lint aprovado.
- Suíte PostgreSQL descartável aprovada: provisionamento, segurança, estado com quarentena adiada e ativação posterior no laboratório, conta, financeiro, nomes, status e cobertura interativa até a 55.
- Build de produção local com Webpack validado separadamente do build remoto da Vercel.

As dependências de perfil, status, nomes e cobertura foram confirmadas por leitura no Supabase existente. A correção não exige aplicar migrations em produção. A quarentena documental da migration 44 e o scanner continuam adiados conforme a configuração anterior; seus arquivos foram versionados, sem ativar o recurso ou contratar serviços.

Nenhuma liberação de acesso, convite ou redefinição de senha é necessária para esta entrega. A confirmação de abertura após a publicação deve usar o cadastro fictício do piloto e encerrar com a restauração da aba do usuário.
