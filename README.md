# jDoc — Sistema de Gestão Eletrônica de Documentos

GED multi-tenant para prefeituras e órgãos públicos (JEOS Sistemas e Assessorias LTDA). Isolamento total por schema PostgreSQL, foco em documentos financeiros e prestação de contas ao TCE.

## Stack

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind — `apps/web` (deploy Vercel)
- **Backend:** NestJS + TypeScript — `apps/api` (deploy Railway)
- **Banco:** PostgreSQL (Supabase) — 1 schema por tenant + catálogo em `public` — Drizzle/postgres.js
- **Cache/filas:** Redis (sessões refresh, brute-force, cache de tenant, BullMQ)
- **Storage:** Supabase Storage — 1 bucket privado por tenant, signed URLs 60s

## Setup local

Pré-requisitos: Node 20+, pnpm 9+, Docker.

```bash
pnpm install
cp .env.example .env          # ajuste segredos
docker compose up -d          # postgres + redis
pnpm --filter @jdoc/database migrate   # catálogo global
pnpm --filter @jdoc/database seed      # tenant demo + superadmin
pnpm --filter @jdoc/api start:dev      # API em :3333
pnpm --filter @jdoc/web dev            # Web em :3000
```

Login demo: `http://localhost:3000/demo/login` (credenciais no output do seed).
Superadmin: `http://localhost:3000/superadmin/login` (TOTP no output do seed).

## Testes

```bash
pnpm -r test                               # unitários (shared + api)
pnpm --filter @jdoc/api test:e2e          # isolamento multi-tenant (requer docker compose up + pnpm db:migrate)
pnpm --filter @jdoc/web exec playwright install chromium   # uma vez
pnpm --filter @jdoc/web test:e2e          # telas: login restrito, idioma, links
```

Primeiro proprietário do painel (pede a senha no terminal; no primeiro acesso o sistema exige a verificação em 2 etapas):

```bash
pnpm admin:create -- --email voce@jeossistemas.com --name "Seu Nome"
```

## Estrutura

```
apps/
  api/        # NestJS — auth (2 realms), tenancy, provisioning, auditoria
  web/        # Next.js — login futurista, shell sidebar/topbar, superadmin
packages/
  shared/     # zod schemas + tipos compartilhados (front e back)
  database/   # drizzle schemas, provisioning de schema por tenant, migrate, seed
```

## Variáveis de ambiente

Ver [.env.example](.env.example). Principais: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `SUPERADMIN_ALLOWED_IPS`, `MAX_UPLOAD_MB`, `FRONTEND_URL`. `SUPABASE_SERVICE_ROLE_KEY` **somente no backend**.

Padrão JEOS (ver [PADRAO_JEOS.md](PADRAO_JEOS.md)):

| Variável | Para quê |
|---|---|
| `TZ=America/Fortaleza` | Fuso do servidor (já vem no Dockerfile; as conexões do banco também usam Fortaleza). |
| `ENCRYPTION_KEY` | 32 bytes em base64 (`openssl rand -base64 32`). Cifra chaves de API, senha do SMTP e o segredo do 2FA. Sem ela, a chave é derivada do `COOKIE_SECRET`; definir depois não perde o que já foi cifrado. |
| `SLOW_REQUEST_MS` | Acima disto (ms, padrão 1000) a requisição entra em "Requisições lentas". |

O servidor de e-mail (SMTP), as chaves de IA, mapas e WhatsApp são configurados no próprio painel (Superadmin › Configurações, ou por órgão em Chaves de API), não em variáveis.

## Deploy (resumo)

1. **Supabase:** criar projeto, copiar `DATABASE_URL` (pooler) e `DIRECT_URL` (direta). Rodar `migrate` apontando para a direta.
2. **Railway:** serviço pelo `Dockerfile.api` (instala `pg_dump` 17 e roda as migrações antes de subir a API) + Redis addon. Configurar todas as env vars.
3. **Vercel:** projeto em `apps/web`, `NEXT_PUBLIC_API_URL` apontando para o Railway.
4. CORS: `FRONTEND_URL` na API = domínio da Vercel.

## Segurança

Ver [SECURITY.md](SECURITY.md) (checklist OWASP Top 10) e [DECISIONS.md](DECISIONS.md).
