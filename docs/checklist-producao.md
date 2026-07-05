# Checklist de produção — jDoc (consolidado)

Ponto único de entrada para TODAS as pendências que dependem de hardware,
certificado, toolchain ou infra do operador. Nada aqui é falta de código novo —
é o que o código pronto precisa para operar de verdade.

> Fontes detalhadas: [`docs/assinatura-icp-brasil-producao.md`](./assinatura-icp-brasil-producao.md)
> (assinatura ICP fim-a-fim), [`apps/desktop/BUILD.md`](../apps/desktop/BUILD.md)
> (instalador/updates), [`apps/desktop/SECURITY-DESKTOP.md`](../apps/desktop/SECURITY-DESKTOP.md)
> (checklist A.5), `DECISIONS.md` e `SECURITY.md`.

---

## 1. Desktop — empacotamento e distribuição

- [ ] **Certificado EV de code signing** (pendência do operador). Sem ele o
      instalador sai não assinado (SmartScreen alerta) e o **auto-update NÃO
      deve ser habilitado**. Configurar `CSC_LINK`/`CSC_KEY_PASSWORD` no build;
      EV em token/HSM exige `signtool` do fornecedor.
      → `apps/desktop/electron-builder.yml:33-41`, `BUILD.md` §Assinatura.
- [ ] **Host real de updates**: `publish.url` é placeholder
      (`https://updates.jeos.example/jdoc-desktop/`). Publicar `latest.yml` +
      `.exe` num host HTTPS e fixar a URL (não depender de `JDOC_UPDATE_URL`).
      → `electron-builder.yml:54-57`, `BUILD.md` §Publicar.
- [ ] **Ícone oficial**: `build/icon.ico` é placeholder gerado por script.
      → `BUILD.md` pré-requisito 2.
- [ ] **Caveat pnpm ⨉ electron-builder**: monorepo com symlinks pode quebrar o
      empacotamento (`@jdoc/shared`); validar `node-linker=hoisted` ou deps
      achatadas ao rodar o primeiro `dist` com EV. → `BUILD.md` §Caveat.

## 2. Desktop — toolchain nativa (máquina do operador)

- [ ] **Python 3.x + Visual Studio Build Tools (MSVC / Desktop C++)** — exigidos
      pelo build nativo do `pkcs11js` (sem prebuilds). Sem eles,
      `signing:status` → `available:false` (degrada, não quebra).
- [ ] **Rebuild dos nativos para o ABI do Electron** após TODO `pnpm install`
      (que os reverte ao ABI do Node):
      `pnpm --filter @jdoc/desktop run rebuild` (keytar + pkcs11js).
- [ ] Caminho com espaço (`C:\Users\Windows 10\...`) pode quebrar o node-gyp —
      considerar checkout sem espaço.
      → detalhes: `docs/assinatura-icp-brasil-producao.md` §1–2.

## 3. Assinatura ICP-Brasil — hardware e bundle

- [ ] **Token A3 físico + middleware (DLL)** instalados; validar
      `C_Login`/`C_Sign`, CMS/CAdES e layout PAdES com PDF real num validador
      ICP (Validar/ITI). Todo o caminho `apps/desktop/electron/signing/` está
      `@pending` de hardware.
- [ ] **Bundle de raízes ICP-Brasil na API**: baixar manualmente de
      https://acraiz.icpbrasil.gov.br, conferir hashes, colocar em
      `apps/api/certs/icp-brasil/` (ou `ICP_ROOTS_DIR`). Sem bundle, toda
      cadeia = `invalida` (comportamento seguro).
- [ ] **OCSP/CRL fim-a-fim** (`@pending`): implementar OCSPRequest + fallback
      CRL com timeout 10s e testar com certificado bom E revogado. Hoje
      revogação = sempre `nao_verificada` (nunca trava).
- [ ] **DNS-rebinding pinning**: o guard anti-SSRF do worker
      (`apps/api/src/signature/url-guard.ts:17-19`) resolve DNS na checagem e
      de novo na conexão — contra rebinding puro falta "pinar" o IP resolvido
      no dispatcher (undici). Faixas privadas/metadata e bloqueio de redirect
      já cobrem os vetores principais.
      → detalhes: `docs/assinatura-icp-brasil-producao.md` §3–5.

## 4. Go-live (Supabase / Railway / Vercel)

- [ ] **Supabase**: projeto criado; `DATABASE_URL` (pooler) + `DIRECT_URL`
      (direta); `migrate` na conexão direta; buckets privados `jdoc-<slug>`;
      `SUPABASE_SERVICE_ROLE_KEY` SOMENTE no backend. → `README.md` §Deploy.
- [ ] **Railway**: serviço da API + Redis addon; todas as env vars validadas
      pelo `loadEnv` (fail-fast); `trust proxy` já configurado.
- [ ] **Vercel**: projeto em `apps/web`; `NEXT_PUBLIC_API_URL` → Railway;
      CORS: `FRONTEND_URL` na API = domínio da Vercel.
- [ ] **Throttle de login sob NAT**: login = 5/min/**IP** (DECISIONS #40).
      Prefeituras inteiras saem por um IP só (NAT) — 5/min pode travar usuários
      legítimos no horário de pico. Reavaliar limite/chave (conta+IP) com
      tráfego real antes do go-live.
- [ ] **E-mail de segurança**: não existe envio de e-mail no sistema (reset de
      senha é manual via admin; sem notificação de eventos de segurança).
      Definir provedor e alertas mínimos (ex.: bloqueio por brute-force,
      sessão revogada por reuso).
- [ ] **`frame-src` restrito à origem do storage**: hoje o desktop
      (`apps/desktop/index.html` CSP + `isAllowedFrameUrl` em
      `electron/main.ts:65-67`) aceita qualquer `https:` no iframe do
      visualizador. Em produção, restringir à origem exata do Supabase Storage.

## 5. Infra de suporte à validação de assinatura

- [ ] Redis no ar (worker BullMQ `signature-validation`).
- [ ] Storage acessível ao worker (`storage.download`: Supabase ou local).
- [ ] Migração das colunas de assinatura aplicada aos tenants existentes
      (via `provision.ts`).

## 6. Hardening — sobras conhecidas (DECISIONS.md §Fase 7a)

- [ ] Checagem de senhas vazadas comuns (lista local a integrar).
- [ ] Throttle adicional: 2FA confirm / recover quando MFA de tenant entrar.
- [ ] Alinhar semântica de URL expirada: `LocalFilesController` = 403,
      `BackupsFilesController` = 400 — padronizar em 403.
- [ ] `pnpm audit` no CI (SECURITY.md A06).

---

## Critério de "pronto de verdade" (assinatura)

1. `signing:status` → `available: true, tokenPresent: true`.
2. PDF assinado no desktop abre válido no validador ICP (Validar/ITI).
3. Upload do PDF assinado → `GET /t/:slug/documents/:id/signature` → `valida`.

Enquanto houver item aberto nas seções 2–3, o comportamento seguro vigente é:
desktop recusa/avisa graciosamente; API marca `invalida`/`nao_verificada`.
