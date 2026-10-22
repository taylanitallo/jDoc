# jDoc

Siga SEMPRE o arquivo PADRAO_JEOS.md (layout, superadmin, fuso, idioma). Em conflito, ele vence.

Adaptações do padrão já decididas para este projeto:
- Rotas do painel da plataforma ficam em `/superadmin/*` (não `/platform/*`); o cliente do padrão é o "órgão" (`public.tenants`, um schema `tenant_<slug>` por órgão).
- Sessão do superadmin: JWT de acesso + refresh rotativo no Redis; `platform.admin_sessions` guarda uma linha por família de refresh (listar/encerrar sessões e `reauth_until`).
- Gráficos usam `apps/web/src/components/charts.tsx` (SVG próprio), não recharts.
- Mudanças de banco: novo arquivo em `packages/database/migrations/catalogo/` (catálogo e schema `platform`) ou `packages/database/migrations/orgao/` (roda em cada schema de órgão). Nunca editar migração já aplicada.
- Datas no front sempre por `apps/web/src/lib/format.ts`; na API, `FUSO_ORGAO` de `@jdoc/shared` (America/Fortaleza).

Commits e push sempre como o usuário git `taylanitallo` (a Vercel bloqueia deploy de outro autor).
Instalar dependências com `npx pnpm@11.9.0 install` (o lockfile exige pnpm 11).
