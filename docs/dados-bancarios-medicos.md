# Dados bancários médicos

A seção está no credenciamento, no formulário administrativo, no perfil médico e na ficha financeira PJ. O portal permite ao médico consultar e editar apenas seu próprio cadastro. Nenhuma operação inicia pagamentos ou altera acordos, vencimentos ou a modalidade do plantão.

## Persistência e compatibilidade

A migration `32_doctor_banking.sql` deve ser aplicada depois da 31, junto da interface correspondente. Ela move o `pix_key` existente do credenciamento para a tabela privada `doctor_banking`, sem inferir o tipo nem descartar o valor. A coluna anterior permanece nullable e vazia para compatibilidade de esquema; somente a tabela privada mantém os valores. Cadastros antigos sem tipo exibem uma pendência e mantêm os acessos operacionais anteriores.

Novos credenciamentos exigem tipo e chave válidos no servidor. Clientes antigos recebem uma orientação para atualizar a página. A aprovação exige regularização bancária. A criação administrativa é atômica: usuários com edição bancária preenchem PIX e tipo; usuários sem essa permissão criam um cadastro pendente para conclusão por um responsável autorizado. Inserir um novo médico ativo diretamente ou ativar um cadastro pendente também exige dados bancários completos. Atualizações que mantêm o status de profissionais antigos não são bloqueadas.

## Permissões e proteção

O módulo `dados_bancarios` possui ações independentes `view`, `edit` e `history`, configuráveis no painel de permissões existente, com os mesmos bloqueios e limites de delegação. Diretor, gerente e financeiro possuem acesso pelo cargo; coordenadores e escalistas precisam de concessão individual explícita. A concessão de Financeiro ou de Escalas não concede acesso bancário adicional. Uma negação de visualização bloqueia as demais ações.

As tabelas bancárias e de auditoria têm RLS habilitado e não concedem acesso direto a `anon` ou `authenticated`. RPCs com `search_path` fixo verificam sessão, empresa, propriedade e ação em cada chamada. A resposta padrão mascara chave, agência e conta. Valores completos são carregados apenas ao exibir ou editar; não são colocados no store persistido, em URLs ou em mensagens de erro. O histórico registra médico, empresa, usuário Auth, horário, operação e nomes dos campos alterados, sem valores anteriores ou novos. O médico vinculado recebe uma notificação interna sem os valores.

Banco, agência e conta são opcionais e permanecem strings. O catálogo pesquisável vem da [BrasilAPI](https://brasilapi.com.br/docs#tag/BANKS), com COMPE, ISPB e nome quando disponíveis. Apenas o catálogo público é consultado; nenhum dado médico é enviado ao serviço. Se a lista estiver indisponível, é possível informar a instituição manualmente ou salvar somente o PIX.

CPF e CNPJ validam os dígitos verificadores. CNPJ numérico e alfanumérico usam o cálculo documentado pela [Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj). Telefones brasileiros aceitam DDD e são normalizados com `+55`; números internacionais usam E.164. EVP exige UUID v4. A validação confere formato, sem consultar registro ou titularidade de chaves.

## Verificação

`npm test` inclui `scripts/doctorBanking.test.mjs`. O laboratório `scripts/test-database.ps1 -PostgresBin <bin do PostgreSQL>` executa as migrations e suítes anteriores, prepara registros legados sintéticos antes da 32 e executa `doctor-banking.verify.sql`. Os testes bancários verificam normalização no SQL, preservação dos valores antigos e da agenda, máscaras, edição própria, negação para outro médico, isolamento entre empresas, permissões, notificação e ausência de valores sensíveis no histórico. A fixture deve ser usada somente em banco descartável, nunca em produção.

## Publicação de 12/11/2026

Após autorização explícita do usuário, a migration 32 foi aplicada ao Supabase NV Med e o deployment `dpl_Dr7GrvYAoUPHdCqjF7GE3z8qYfCm` foi promovido para [med.nvcore.com.br](https://med.nvcore.com.br). A publicação partiu do workspace atual pela Vercel CLI, incluindo as alterações de setores já presentes, sem criar commit ou alterar o histórico Git.

Validação concluída: 98 testes Node, ESLint, TypeScript, build local e build Production; laboratório SQL completo 19–32, incluindo criação administrativa atômica e bloqueio de inserção direta. A consulta de pós-publicação confirmou migração dos valores existentes, fonte única, RLS, bloqueio de leitura/edição direta, proteção do helper interno, negação à coordenação e acesso financeiro. A interface foi conferida em desktop e em 390 px nos temas claro e escuro, com largura sem transbordamento. O catálogo publicado retornou 470 instituições. As verificações visuais não salvaram dados de médicos nem executaram pagamentos.
