# SECURITY.md — jDoc

Checklist OWASP Top 10 (2021) — estado ao fim da **Fase 1**. Atualizado a cada fase.

## A01 — Broken Access Control

- RBAC **deny-by-default**: rota autenticada sem `@Permissions` explícito = 403 (`PermissionsGuard`). Admin do tenant passa; demais precisam de TODAS as permissões declaradas.
- **Isolamento multi-tenant**: `TenancyMiddleware` resolve slug → catálogo (cache 60s) → injeta contexto ALS. `TenantJwtGuard` compara `tenantId` do token com o tenant da URL — divergência = 401 + `global_audit_logs` (`cross_tenant_attempt`).
- Realms tenant/superadmin com issuer/audience JWT distintos, tabelas distintas, cookies com paths distintos. Token de tenant não passa no `SuperadminJwtGuard` (e vice-versa).
- Testes: `permissions.guard.spec.ts` (unit), `isolation.e2e-spec.ts` (integração).
- Fases futuras: anti-IDOR por recurso (toda busca por id filtra tenant) — padrão já garantido pelo pool com `search_path` fixado.

## A02 — Cryptographic Failures

- Senhas: **Argon2id** (m=64MiB, t=3). Refresh tokens no Redis apenas como **SHA-256**.
- TLS em trânsito (Vercel/Railway/Supabase); criptografia em repouso (Supabase).
- Segredos somente em env vars (`loadEnv` valida ≥32 chars nos secrets, fail-fast).
- HSTS habilitado (`helmet`, max-age 1 ano, includeSubDomains, preload).

## A03 — Injection

- **SQLi:** 100% tagged templates parametrizadas (postgres.js). `sql.unsafe` APENAS para identificadores de schema validados por allowlist `^tenant_[a-z0-9_]{2,30}$` (identificador não é parametrizável por bind — allowlist é a defesa correta).
- **XSS:** escape padrão do React; CSP da API `default-src 'none'`; access token nunca em localStorage.
- Validação **zod `.strict()`** em toda entrada — campos extras = 400 (`ZodValidationPipe`).

## A04 — Insecure Design

- Regra de ouro: nenhuma query de negócio sem contexto de tenant (`requireTenantContext` lança fora do middleware).
- Login em tempo ~constante (argon2 contra hash dummy) — anti-enumeração por timing.
- Mensagens genéricas em login/refresh (anti-enumeração de usuários).
- Decisões de segurança documentadas em DECISIONS.md.

## A05 — Security Misconfiguration

- `helmet` com CSP estrita, `X-Frame-Options: DENY`, `nosniff`, HSTS.
- CORS restrito a `FRONTEND_URL`, com credentials.
- Erros nunca vazam stack/SQL (`AllExceptionsFilter` — erro não tratado vira "Erro interno" e loga completo no servidor).
- Env validada com zod no boot; API não sobe com config inválida.
- Next.js: `poweredByHeader: false`, headers de segurança em todas as rotas.

## A06 — Vulnerable and Outdated Components

- pnpm com lockfile; `onlyBuiltDependencies` allowlist para scripts de build nativos.
- Fase 7: auditoria de dependências (pnpm audit) no CI.

## A07 — Identification and Authentication Failures

- JWT de acesso **15 min**; refresh **rotativo 7 dias** em cookie `httpOnly; Secure; SameSite=Strict` com path escopado.
- **Detecção de reuso de refresh**: segredo antigo apresentado = família inteira revogada + log de segurança.
- **Brute-force progressivo**: 5 falhas → backoff exponencial (30s → 1h cap), por conta E por IP (Redis). Testado em `brute-force.service.spec.ts`.
- **2FA TOTP obrigatório para superadmin** — sem TOTP configurado, login falha.
- `must_change_password` no primeiro acesso; logout de todas as sessões (`revokeAllForUser`).

## A08 — Software and Data Integrity Failures

- Auditoria append-only: `audit_logs` por tenant + `global_audit_logs` no public (login, falha, logout, eventos cross-tenant, ações de superadmin).
- Fase 3: hash SHA-256 de arquivos; Fase 7: verificação de integridade de backups.

## A09 — Security Logging and Monitoring Failures

- Eventos logados: `login`, `login_failed`, `logout`, `logout_all`, `cross_tenant_attempt`, `cross_tenant_refresh_attempt`, `refresh_reuse_or_invalid`, `superadmin_login`, `superadmin_login_failed`, `superadmin_logout`.
- IP + user-agent registrados. Logs de segurança cross-tenant sempre no catálogo global.

## A10 — SSRF

- Backend não faz fetch de URLs fornecidas pelo usuário (política; nenhuma rota atual aceita URL).
- Fase 3+: uploads vão direto ao Supabase Storage via backend — nunca fetch de URL externa.

---

## Checklist Apêndice B (estado Fase 1)

| # | Item | Estado |
|---|------|--------|
| 1 | Tenant A não acessa dado do tenant B | ✅ guard + testes e2e (auth, docs) |
| 2 | Token tenant ↛ /superadmin e vice-versa | ✅ realms separados + teste e2e |
| 3 | Refresh httpOnly + revogação | ✅ rotação, reuso, revokeAll |
| 4 | Upload rejeita não-PDF (magic bytes `%PDF`) | ✅ testado e2e (`virus.pdf` → 400) |
| 5 | Quota bloqueia upload a 100% | ✅ testado e2e (quota 1 MB → 403) |
| 6 | Rate limiting | brute-force ✅; rate limit por rota na Fase 7 |
| 7 | Sem stack trace em produção | ✅ AllExceptionsFilter |
| 8 | Signed URLs 60s expiram | ✅ testado e2e (URL expirada → 403) |
| 9 | Soft delete/lixeira (retenção 30d) | ✅ testado e2e (linha permanece, restore ok) |
| 10 | Auditoria de ações críticas | ✅ created/updated/deleted/restored/download |
| 11-12 | ICP-Brasil / Desktop | Fase 8 |
