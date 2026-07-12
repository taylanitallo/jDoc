# jDoc Desktop — build, instalador e auto-update

Guia para gerar o instalador Windows (NSIS), assinar com o certificado EV e
publicar atualizações. A **configuração** está pronta (`electron-builder.yml`,
`electron/updater.ts`); o **empacotamento real** do `.exe` fica para quando o
operador rodar com o EV em mãos.

> ⚠️ Rodar `electron-builder` baixa o NSIS (~alguns MB) na primeira vez, para
> `~/.cache/electron-builder`. Por isso o Marco 6 **não** empacotou — só deixou
> tudo pronto e o build de código verde.

## Pré-requisitos

1. **Módulos nativos compilados para o electron** (keytar, pkcs11js):
   ```
   pnpm --filter @jdoc/desktop run rebuild
   ```
   pkcs11js exige **Python + Visual Studio Build Tools** (ver
   `docs/assinatura-icp-brasil-producao.md`). Todo `pnpm install` reverte os
   nativos ao ABI do Node — rode `run rebuild` de novo depois de instalar.
2. **Ícone**: `build/icon.ico` é o ícone oficial (logo jDoc, multi-resolução
   16–256px, gerado a partir de `Logo_executavel.png` na raiz do repo).
   `build/make-icon.mjs` gera um placeholder roxo liso — só rodar se precisar
   voltar a um placeholder.

## Gerar o instalador

```
# app não empacotado em .exe, só a pasta (rápido, sem instalador):
pnpm --filter @jdoc/desktop pack:dir

# instalador NSIS completo (baixa o NSIS na 1ª vez):
pnpm --filter @jdoc/desktop dist
```

Ambos rodam `electron-vite build` antes. A saída vai para `apps/desktop/release/`.
O artefato é `jDoc Desktop-<versão>-x64.exe` (instalação assistida: o usuário
escolhe a pasta — `oneClick: false`, `allowToChangeInstallationDirectory: true`).

### Caveat pnpm ⨉ electron-builder

Em monorepo pnpm, o `electron-builder` pode não resolver as deps symlinkadas
(inclui o workspace `@jdoc/shared`). Se o empacotamento reclamar de módulos,
opções: usar `node-linker=hoisted` para o app desktop, ou empacotar a partir de
um diretório com as deps de produção "achatadas". Validar ao rodar com o EV.

## Assinatura do executável (certificado EV) — PENDÊNCIA DO OPERADOR

Por default o build sai **não assinado** e funciona para teste — mas o
**SmartScreen** do Windows alertará "editor desconhecido". Para assinar:

1. Tenha o **certificado EV** de code signing (arquivo `.pfx` + senha).
2. Defina no ambiente do build (o electron-builder detecta sozinho):
   ```
   # PowerShell
   $env:CSC_LINK = "C:\caminho\certificado-ev.pfx"   # ou base64 do arquivo
   $env:CSC_KEY_PASSWORD = "senha-do-certificado"
   pnpm --filter @jdoc/desktop dist
   ```
3. Com EV via token/HSM (comum no Brasil), pode ser necessário usar a
   assinatura por hardware (ex.: `signtool` com o provider do token) — nesse
   caso configurar `win.sign` / `signingHashAlgorithms` conforme o fornecedor.

Sem `CSC_LINK`/`CSC_KEY_PASSWORD`, os campos de assinatura ficam desativados
(comentados no `electron-builder.yml`) e o build prossegue sem assinar.

## Publicar uma atualização (auto-update)

O `electron-updater` usa o `publish` do `electron-builder.yml` (hoje `generic`).

1. **Defina o destino**: edite `publish.url` no `electron-builder.yml` (o host
   que servirá os arquivos), ou troque para `provider: github` (owner/repo).
   Em runtime dá para sobrepor a URL com `JDOC_UPDATE_URL` (ver `updater.ts`).
2. **Gere e publique**:
   ```
   pnpm --filter @jdoc/desktop dist        # gera o .exe + latest.yml
   # publique release/*.exe e release/latest.yml na URL do provider
   ```
   O `latest.yml` (gerado pelo electron-builder) é o que o updater lê para
   descobrir a versão nova. **Sempre publique o `latest.yml` junto do `.exe`.**
3. **Versão**: suba `version` no `package.json` a cada release — o updater só
   oferece update se a versão remota for maior que a instalada.

### Comportamento em runtime

- No boot, `initAutoUpdateOnBoot()` faz uma checagem **silenciosa**; falha de
  rede ou config ausente **não quebram o app**.
- Handlers IPC disponíveis ao renderer: `app:version` e `app:check-update`
  (este retorna `{ packaged, currentVersion, updateAvailable, latestVersion, error }`).
- Em desenvolvimento (`app` não empacotado) o auto-update fica inativo por design.
