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
pnpm --filter @jdoc/api test:e2e          # isolamento multi-tenant (requer docker compose up)
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

## Deploy (resumo)

1. **Supabase:** criar projeto, copiar `DATABASE_URL` (pooler) e `DIRECT_URL` (direta). Rodar `migrate` apontando para a direta.
2. **Railway:** serviço a partir de `apps/api` (`pnpm --filter @jdoc/api build && node apps/api/dist/main.js`) + Redis addon. Configurar todas as env vars.
3. **Vercel:** projeto em `apps/web`, `NEXT_PUBLIC_API_URL` apontando para o Railway.
4. CORS: `FRONTEND_URL` na API = domínio da Vercel.

## Segurança

Ver [SECURITY.md](SECURITY.md) (checklist OWASP Top 10) e [DECISIONS.md](DECISIONS.md).
