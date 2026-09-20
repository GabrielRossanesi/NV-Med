# 🚀 Configuração do Supabase (São Paulo / sa-east-1) - NV Med

Este guia contém as instruções passo a passo para conectar o banco de dados PostgreSQL do **Supabase** ao seu aplicativo **NV Med** hospedado na **Vercel**.

---

## 📍 Passo 1: Criar o Projeto no Supabase com Servidor em São Paulo

1. Acesse [supabase.com](https://supabase.com) e faça login na sua conta.
2. Clique no botão **New Project**.
3. Preencha os dados do projeto:
   - **Name**: `NV-Med` (ou o nome que preferir)
   - **Database Password**: Escolha uma senha forte e guarde-a com segurança.
   - **Region**: Selecione obrigatoriamente **`South America (São Paulo) - sa-east-1`**.
     *(Isso garante latência mínima para os usuários no Brasil: 10 a 30ms).*
4. Clique em **Create new project** e aguarde 1 a 2 minutos até o provisionamento concluir.

---

## ⚡ Passo 2: Executar o banco

1. No menu lateral esquerdo do Dashboard do Supabase, clique no ícone **SQL Editor** (ou acesse a URL: `https://supabase.com/dashboard/project/<seu-projeto>/sql`).
2. Clique em **+ New query**.
3. Em uma instalação nova, execute `init_all.sql` para criar a estrutura e os dados de demonstração.
4. Depois execute, nesta ordem: `04_storage.sql`, `05_production.sql` e `06_operational_scheduling.sql`.
5. Crie o usuário no Supabase Auth e use `07_bootstrap_admin.sql` para vinculá-lo ao perfil administrativo.
6. Clique no botão verde **Run** em cada etapa.

> O script criará automaticamente:
> - Todas as tabelas relacionais (`organizations`, `doctors`, `units`, `sectors`, `shifts`, `medical_documents`, `user_accounts`).
> - Índices de alta performance e triggers de auditoria (`updated_at`).
> - Políticas de segurança Row Level Security (RLS).
> - Bucket de armazenamento de arquivos médicos (`medical-documents`).
> - Carga inicial completa de dados (empresas, médicos, plantões, documentos e usuários demo).

---

## 🔑 Passo 3: Obter as Chaves de Conexão

1. No Supabase, clique na engrenagem de configurações no canto inferior esquerdo (**Project Settings**).
2. Acesse a aba **Data API** (ou **API**).
3. Localize e copie os seguintes valores:
   - **Project URL** (ex: `https://abcdefghijkl.supabase.co`)
   - **anon public API Key** (ex: `eyJhbGciOiJIUzI1Ni...`)
   - *(Opcional)* **service_role secret** (para operações de backend irrestritas na Vercel).

---

## ⚙️ Passo 4: Configurar as Variáveis na Vercel e Localmente

### A. Para rodar na sua máquina localmente:
Crie um arquivo chamado `.env.local` na raiz do projeto (`E:/0. Projetos/NV-Med/.env.local`) com o seguinte conteúdo:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_anon_aqui
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role_aqui
```

### B. Para o Deploy na Vercel:
1. Acesse o painel do seu projeto na [Vercel](https://vercel.com).
2. Vá em **Settings** -> **Environment Variables**.
3. Adicione as mesmas variáveis:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Dispare um novo deploy (ou faça `git push`).

---

## ✅ Passo 5: Testar a Conexão

Após adicionar as chaves e iniciar o sistema (`npm run dev` ou na Vercel):
- Acesse a rota: `http://localhost:3000/api/health` (ou `https://seu-dominio.vercel.app/api/health`).
- A resposta esperada será:
```json
{
  "status": "online",
  "database": "supabase",
  "region": "São Paulo (sa-east-1)",
  "supabaseConfigured": true,
  "connected": true,
  "organizationsCount": 3
}
```

Qualquer alteração feita nas telas (médicos cadastrados, plantões criados, etc.) será salva instantaneamente no PostgreSQL do Supabase em São Paulo!
