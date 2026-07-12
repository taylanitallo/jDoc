# SECURITY-DESKTOP.md — jDoc Desktop

Checklist de segurança do desktop (Apêndice A.5), auditado **contra o código
real** ao fim da Fase 8 / Marco 7. Cada item aponta o arquivo que o implementa.

> Legenda: **mitigado** = implementado e verificável no código ·
> **parcial** = implementado com lacuna documentada ·
> **@pending** = depende de hardware/certificado/infra do operador.
> Pendências consolidadas em [`docs/checklist-producao.md`](../../docs/checklist-producao.md).

| # | Item | Status |
|---|------|--------|
| 1 | contextIsolation / sandbox / nodeIntegration | **mitigado** |
| 2 | Allowlist de IPC (deny-by-default) | **mitigado** |
| 3 | Tokens fora do renderer | **mitigado** |
| 4 | keytar para o refresh token | **mitigado** (rebuild nativo pendente) |
| 5 | Bloqueio de navegação externa | **parcial** |
| 6 | Validação zod nos handlers IPC | **mitigado** |
| 7 | Magic bytes no upload (cliente + revalidação) | **mitigado** |
| 8 | CSP do renderer | **parcial** |
| 9 | Code signing do instalador | **@pending** (certificado EV) |
| 10 | Auto-update seguro | **parcial** (@pending EV + host real) |

---

## 1. contextIsolation / sandbox / nodeIntegration — mitigado

`electron/main.ts:34-42`: a única `BrowserWindow` é criada com
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true` e `nodeIntegrationInWorker: false`. Reforços no mesmo
arquivo: menu de aplicação removido (`Menu.setApplicationMenu(null)`,
`main.ts:125`) e single-instance lock (`main.ts:113`).

## 2. Allowlist de IPC — mitigado

Canal ÚNICO de invoke roteado por `kind` contra allowlist explícita:

- `electron/ipc/contract.ts:30-48` — `INVOKE_KINDS` (17 operações) + type guard
  `isInvokeKind`. Arquivo sem dependências, importável pelo preload sandboxed.
- `electron/preload.ts:18-23` — o preload rejeita kind fora da allowlist ANTES
  de ir ao main; expõe apenas `invoke`, `onSessionExpired` e `onUploadProgress`
  via `contextBridge` (nada de `ipcRenderer` cru).
- `electron/ipc/handlers.ts:96-101` — o main NÃO confia no preload: revalida o
  kind e o payload de novo (deny-by-default nas duas pontas).

## 3. Tokens fora do renderer — mitigado

- Access token vive SÓ em memória do processo main:
  `electron/session/session-store.ts` ("jamais em disco, jamais exposto ao
  renderer").
- Todo fetch ao backend acontece no main: `electron/api/client.ts` — o renderer
  nunca vê `Authorization` nem cookies. A visão de sessão entregue ao renderer
  é `{ user, tenant }` sem token (`client.ts:189-191`).
- A CSP do renderer tem `connect-src 'self'` (`index.html`), então o renderer
  nem consegue falar com a API diretamente.

## 4. keytar para o refresh token — mitigado (rebuild nativo pendente)

`electron/session/keychain.ts`: refresh token no Windows Credential Manager
(service `jdoc-desktop`), **sem fallback para disco** — se o keytar não carrega,
`assertAvailable()` lança e o login é recusado (`api/client.ts:121`). Restore de
boot revalida no backend e descarta credencial morta (`client.ts:144-157`).
Logout apaga a credencial (`client.ts:170-186`).

Pendência operacional (não de código): `keytar` precisa de rebuild para o ABI
do Electron após qualquer `pnpm install` (`BUILD.md`, pré-requisito 1). Sem o
rebuild o app degrada com erro claro e login recusado — nunca inseguro.

## 5. Bloqueio de navegação externa — parcial

`electron/main.ts:77-99` (`hardenNavigation`):

- `will-navigate`: frame principal só navega para a URL do dev server; qualquer
  outro destino é cancelado. **mitigado**.
- `setWindowOpenHandler`: `window.open` sempre negado; `https:` legítimo abre
  no browser padrão via `shell.openExternal`. **mitigado**.
- `will-frame-navigate` (iframe do visualizador de PDF): permite `API_ORIGIN`
  **ou qualquer `https:`** (`isAllowedFrameUrl`, `main.ts:65-67`). A intenção é
  a signed URL (API local ou Supabase), mas a regra é mais larga que o
  necessário — um link dentro de um PDF para qualquer site https navegaria o
  iframe. **Lacuna documentada:** restringir à origem exata do storage em
  produção (ver `docs/checklist-producao.md`).

## 6. Validação zod nos handlers — mitigado

- `electron/ipc/schemas.ts`: um schema por kind, todos `.strict()` (campo extra
  = rejeição), reusando `emailSchema`/`tenantSlugSchema`/`docModuleSchema`
  canônicos do `@jdoc/shared`.
- `electron/ipc/handlers.ts:100`: `handler.schema.parse(payload ?? {})` roda
  antes de qualquer efeito, para TODOS os kinds (inclusive os sem payload, via
  `emptyPayloadSchema` estrito).

## 7. Magic bytes no upload — mitigado

Três camadas:

1. **Renderer** (`src/components/UploadView.tsx:36-45`): lê os 4 primeiros
   bytes e exige `%PDF`, além de extensão `.pdf`, limite de MB e campos via
   `documentFieldsSchema`.
2. **Main revalida — não confia no renderer**
   (`electron/upload/prepare.ts:12-31`): magic bytes `%PDF` de novo, tamanho
   máximo, campos contra o schema canônico e SHA-256 do conteúdo.
3. **API revalida no servidor** (DECISIONS.md #27, testado e2e: `.pdf` com
   conteúdo não-PDF → 400).

## 8. CSP do renderer — parcial

`index.html:12-15`:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; frame-src 'self'
http://localhost:3333 https:; object-src 'self' http://localhost:3333 https:`

- **mitigado**: sem script inline, sem eval, sem origem externa para script;
  `connect-src 'self'` impede o renderer de falar com qualquer backend.
- **lacunas**: `frame-src`/`object-src` aceitam qualquer `https:` (deveria ser
  a origem exata do storage em produção — mesma lacuna do item 5) e
  `style-src 'unsafe-inline'` (exigido por estilos inline do React/Vite hoje).

## 9. Code signing do instalador — @pending

**Não existe assinatura de código no repositório** — depende do certificado EV
(pendência do operador). O que existe:

- `electron-builder.yml:33-41`: bloco documentado e desativado; ao definir
  `CSC_LINK`/`CSC_KEY_PASSWORD` no ambiente, o electron-builder assina sozinho.
- `BUILD.md` ("Assinatura do executável"): passo a passo, incluindo o caso de
  EV em token/HSM via `signtool`.

Sem EV o instalador sai não assinado e o SmartScreen alerta "editor
desconhecido".

## 10. Auto-update seguro — parcial (@pending EV + host real)

O que existe (`electron/updater.ts` + `electron-builder.yml:54-57`):

- `electron-updater` com provider `generic`; checagem silenciosa no boot,
  falha de rede nunca derruba o app; inativo em dev (app não empacotado);
  handlers `app:version` / `app:check-update` expostos ao renderer.

O que falta para ser **seguro** de verdade:

- **Code signing (item 9) é pré-requisito**: sem executável assinado, um host
  de updates comprometido poderia entregar binário malicioso sem nenhuma
  verificação de autoria. Não habilitar auto-update em produção antes do EV.
- `publish.url` é placeholder (`https://updates.jeos.example/...`) — falta o
  host HTTPS real que servirá `latest.yml` + `.exe` (ver `BUILD.md`).
- `JDOC_UPDATE_URL` permite sobrepor a URL em runtime — conveniente em teste;
  em produção, preferir a URL fixa do `app-update.yml` gerado no build.

---

## Fora do checklist, mas relevante

- **Expiração por inatividade** (`electron/session/idle.ts` + `main.ts:48-50`):
  idle → logout real (revoga no backend + limpa keychain) + renderer volta ao
  login.
- **Single-flight refresh com rotação** (`api/client.ts:56-89`): um único
  refresh em voo; o token rotacionado volta ao keychain imediatamente.
- **Verificação de assinatura ICP-Brasil** (checa se um PDF enviado já vem
  assinado — o desktop não assina nada): estados e pendências detalhados em
  [`docs/assinatura-icp-brasil-producao.md`](../../docs/assinatura-icp-brasil-producao.md).
