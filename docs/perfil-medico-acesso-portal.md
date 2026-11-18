# Perfil médico e liberação individual do Portal Médico

## Comportamento

O cadastro administrativo, o credenciamento profissional e a credencial de autenticação são independentes. Cadastrar ou importar um médico não chama o Auth nem envia e-mails. A migration 36 não altera registros médicos existentes, não aprova credenciamentos e não faz liberação em lote.

Na ficha, **Editar perfil** carrega uma fotografia atual do banco e reutiliza os campos do formulário de cadastro. Permite corrigir os dados pessoais, profissionais, endereço, RQE, contratação e, havendo credenciamento, nascimento e especialidades. Valida apenas os valores alterados para permitir a correção gradual de dados importados incompletos. A revisão impede salvar por cima de alterações concorrentes. O e-mail é administrado na seção de acesso; documentos e informações bancárias mantêm os componentes e as permissões próprios.

O cadastro administrativo mantém o fluxo de criação existente, sem gerar registro no Auth. Para médicos novos ou antigos sem credenciamento, **Preparar credenciamento** cria somente o registro profissional, quando solicitado, com `auth_user_id` vazio. **Analisar credenciamento e vínculos** abre a fila existente para aprovar especialidades e unidades. A aprovação conserva as validações bancárias e documentais e passa a aceitar a ausência de conta Auth. Médicos aprovados podem ser atribuídos às escalas sem acesso ao portal. A liberação do portal não aprova nem modifica esses vínculos.

## Acesso individual

1. **Não liberado:** nenhum usuário Auth vinculado ao cadastro. Cadastro e escalas continuam disponíveis ao administrativo.
2. **Liberar acesso ao portal:** abre confirmação com o e-mail, valida permissão, revisão, formato, duplicidade e conflito com contas administrativas. Um marcador aleatório identifica a operação autorizada. O convite nativo `inviteUserByEmail` cria a conta; o trigger de Auth associa o médico existente na transação de criação, antes do envio. Nenhum novo médico é criado.
3. **Convite pendente:** a conta ainda precisa confirmar o e-mail/definir a senha. O metadado protegido `must_change_password` obriga a definição pelo fluxo existente. O reenvio para uma conta já vinculada utiliza o link de recuperação do Supabase, preservando sua identidade. Se já existe uma conta médica não vinculada ao mesmo e-mail, a liberação explícita a associa sem criar outra. Contas administrativas são recusadas.
4. **Ativo:** o e-mail foi confirmado e a senha definida. As funcionalidades médicas dependem também do credenciamento, da situação cadastral e dos vínculos autorizados.
5. **Bloqueado:** conta Auth bloqueada ou cadastro médico inativo. O bloqueio do Auth impede inclusive consultas com JWT anterior, pelo mecanismo existente `nv_session_actor`. Desbloquear o Auth não reativa um cadastro inativo nem aprova credenciamento.

**Redefinir senha** envia apenas um link seguro. Não consulta, gera nem copia senhas. **Copiar dados de acesso** copia somente o e-mail e o endereço do portal, incluindo o contexto da empresa.

Alterar e-mail e bloquear/desbloquear uma conta Auth afeta todas as empresas ligadas à mesma identidade. A confirmação informa isso e o banco exige permissão em todos os vínculos. A mudança do e-mail no Auth aciona um trigger na mesma transação que sincroniza os cadastros associados. Conflitos em qualquer cadastro desfazem também a alteração do Auth.

Cada solicitação gera uma operação auditável, seguida de conclusão ou falha. Existe intervalo de um minuto entre ações na mesma conta/cadastro. Falhas de entrega são exibidas; não há envio em background, fila paga ou disparo em lote. Um erro de rede exige atualizar o status antes de repetir.

## Permissões e privacidade

- Edição cadastral: `medicos.edit`, mantendo as decisões de cargo e exceções atuais.
- Gestão de acesso: novo módulo `portal_medico`, ações `view` e `edit`. Por padrão: CEO/Gerente SaaS e Diretor/Gerente da empresa. Outros perfis da empresa precisam de concessão expressa das duas ações; negações individuais continuam válidas. A delegação segue o painel existente de permissões.
- Uma concessão de edição cadastral ou de escalas não concede gestão de credenciais.
- Médico aprovado: edita somente o próprio nome, telefone e endereço. Outros campos são consultáveis em seu formulário, mas mudanças profissionais dependem da coordenação. Dados bancários e documentos continuam usando os módulos existentes de autoatendimento.
- RPCs fazem a verificação no servidor; as tabelas de operações e auditoria não permitem leitura/escrita direta pelo navegador. A finalização das operações só pode ser chamada com `service_role`, no backend.
- Triggers auditam mudanças cadastrais inclusive por atualização direta autorizada no banco. Auditoria registra campos afetados, ator, horário e, para e-mail, antes/depois; nunca registra senha, token ou dados bancários completos.
- `SUPABASE_SERVICE_ROLE_KEY` permanece somente no ambiente do servidor. Não há chave administrativa no bundle público.
- O autocredenciamento não pode reivindicar cadastros administrativos/importados sem liberação individual. O fluxo de novos profissionais que ainda não pertencem ao cadastro continua disponível.

## Implantação

1. Executar `supabase/doctor-access-inventory.read-only.sql` no destino confirmado. Identifica por empresa médicos sem credenciamento/Auth, e-mails inválidos ou divergentes, duplicidades e contas compartilhadas. O script é somente leitura e não exibe nomes, CPFs ou e-mails. O inventário equivalente foi executado na publicação de 18/11/2026, conforme o relatório abaixo.
2. Confirmar migrations 01–35, inclusive as alterações locais de importação. Aplicar `supabase/36_doctor_profile_access.sql` antes de publicar esta interface. A migration é incremental e transacional. Não executar o instalador histórico nem scripts de fixtures em produção.
3. Conferir `SUPABASE_SERVICE_ROLE_KEY`, as variáveis Supabase e a origem oficial exigidas pela configuração atual. Não adicionar segredos com prefixo `NEXT_PUBLIC_`.
4. Em Auth → URL Configuration, manter o Site URL oficial e autorizar `https://med.nvcore.com.br/definir-senha` e `https://med.nvcore.com.br/auth/confirm`. O domínio vem do helper `authFlowUrl` já existente.
5. Conferir os templates de convite e recuperação. Para o fluxo SSR entre dispositivos, usar links para `https://med.nvcore.com.br/auth/confirm?token_hash={{ .TokenHash }}&type=invite` no convite e `type=recovery` na recuperação. O callback existente verifica o token e abre a definição de senha; a expiração e o uso único são controlados pelo Supabase. Não expor links/tokens no painel administrativo.
6. Conferir o SMTP já usado pelo projeto. O SMTP padrão do Supabase restringe destinatários à equipe do projeto, portanto não basta para os médicos externos. Usar um SMTP existente ou uma opção gratuita compatível, dentro dos limites de envio, configurada no próprio Supabase. Nenhum provedor ou assinatura foi adicionado pelo código. Referência: [SMTP do Supabase](https://supabase.com/docs/guides/auth/auth-smtp).
7. Publicar a aplicação. Homologar com um único médico sintético autorizado: liberar acesso, abrir o e-mail em outro navegador, definir senha, entrar, verificar perfil/agenda/vagas/candidaturas/trocas, redefinir senha e bloquear/desbloquear. Verificar a auditoria e os vínculos após cada etapa. Não disparar convites de teste para médicos reais.

## Verificações locais

- `npm test`: testes de regras e validação de permissões, incluindo a separação entre edição de cadastro e gestão de credenciais.
- `npx tsc --noEmit` e `npm run lint`.
- `npm run build:local`: build sem credenciais Supabase, conforme o mecanismo existente de isolamento.
- `scripts/test-database.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\16\bin'`: cria um PostgreSQL temporário, aplica 01–36 e executa as suítes SQL com fixtures e rollback. Não acessa Supabase remoto.
- `supabase/doctor-profile-access.verify.sql`: credenciamento e escala sem Auth; criação sem convite; edição própria e administrativa; isolamento por médico e tenant; validação/revisão; gestão negada a escalistas; vínculo individual; reenvio sem duplicação; sincronização/rollback de e-mail; bloqueio de sessão antiga; auditoria e preservação de vínculos; consulta de agenda/vagas, candidatura, cancelamento e solicitação de troca.

As verificações SQL locais simulam as transações do Auth. Não substituem a homologação do GoTrue, da entrega SMTP, dos links em outro navegador e da interface autenticada no ambiente de homologação.

## Estado da publicação

Em 18/11/2026, com autorização explícita, a migration 36 foi aplicada e a interface foi publicada em produção. Os dados existentes foram comparados e preservados; nenhum acesso foi liberado nem convite foi enviado. Consulte o [relatório da publicação](publicacao-perfil-medico-2026-11-18.md) para identificação do deploy, backup, contagens e verificações.
