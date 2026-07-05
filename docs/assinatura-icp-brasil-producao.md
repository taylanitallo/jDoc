# Assinatura ICP-Brasil — checklist para produção

Consolidação do que os Marcos 5a (desktop, assinatura no token) e 5b (API,
validação) entregaram **compilando + com degradação graciosa**, e do que ainda
depende de **hardware, bundle oficial ou toolchain** para funcionar de verdade.

> Legenda: `[ ]` pendente · `[x]` feito · `@pending` = implementado mas não
> exercitado fim-a-fim (falta hardware/bundle/rede real).

---

## Estado atual (o que já está pronto)

- [x] **5a — Infra PKCS#11 no desktop** (`apps/desktop/electron/signing/`): carga
  configurável da lib, auto-detecção das DLLs (SafeNet/Gemalto/Watchdata), status
  gracioso, listagem de certs, login/PIN, `C_Sign`, CMS/CAdES (node-forge com o
  token como chave externa), PAdES (@signpdf). Compila + detecta graciosamente.
- [x] **5a — Fluxo no renderer**: modal "assinar antes de enviar", PIN confinado,
  o arquivo enfileirado passa a ser o assinado; sem token → mensagem clara.
- [x] **5b — Validação na API** (`apps/api/src/signature/`): parsing ByteRange/CMS,
  integridade (digest + RSA) **testada**, worker BullMQ, colunas em `documents`,
  `GET /t/:slug/documents/:id/signature`.
- [x] **5b — Unit tests** (4/4): mecânica válida com self-signed; cadeia ICP
  `invalida` — o assert correto sem bundle.

---

## 1. pkcs11js — build nativo (desktop / máquina do operador)

O binário nativo do `pkcs11js` **não tem prebuilds**: compila via node-gyp e
exige toolchain. Sem ele, `signing:status` retorna `available:false` (gracioso).

- [ ] Instalar **Python 3.x** (node-gyp não achou Python nesta máquina).
- [ ] Instalar **Visual Studio Build Tools** (workload "Desktop C++" / MSVC).
- [ ] Rodar o rebuild contra o ABI do electron:
      `pnpm --filter @jdoc/desktop run rebuild`
      (script: `electron-rebuild -f -w keytar,pkcs11js`).
- [ ] ⚠️ **Reinstalar reverte**: todo `pnpm install`/`pnpm rebuild` reexecuta o
      `prebuild-install` e volta os nativos ao ABI do Node — **rodar `run rebuild`
      de novo** depois de qualquer install.
- [ ] Caminho com espaço (`C:\Users\Windows 10\...`) gera aviso do node-gyp;
      considerar um checkout sem espaço se a compilação falhar por isso.

## 2. keytar — rebuild isolado (desktop, smoke do login / Marco 2)

- [ ] O keytar tem prebuild e compila sem Python: `electron-rebuild -f -w keytar`.
      (Necessário após os installs recentes, que o reverteram ao ABI do Node.)

## 3. Bundle de raízes ICP-Brasil (API / 5b)

`@pending` até o bundle existir — sem ele, **toda cadeia fica `invalida`**.

- [ ] Baixar **manualmente** as ACs Raiz de **https://acraiz.icpbrasil.gov.br**
      (não é automático — decisão de segurança).
- [ ] Colocar os `.pem/.crt/.cer` em `apps/api/certs/icp-brasil/`.
- [ ] (Opcional) apontar `ICP_ROOTS_DIR` para outro diretório.
- [ ] Conferir hash/veracidade dos arquivos antes de confiar.

## 4. Token ICP-Brasil real (ponta a ponta / 5a + 5b)

- [ ] Middleware do token instalado (a DLL que a auto-detecção acha).
- [ ] Token físico plugado, com certificado A3 ICP válido.
- [ ] **5a**: `dev` → aba Enviar → assinar → confirmar `C_Login`/`C_Sign`, CMS e
      layout PAdES no PDF resultante.
- [ ] **5b**: subir o PDF assinado → o worker roda cadeia + revogação → coluna
      `assinatura_status` grava `valida`/`nao_verificada` (não mais `invalida`).

## 5. Revogação OCSP/CRL (API / 5b) — `@pending`

Hoje sempre `nao_verificada` (nunca trava). Falta o protocolo fim-a-fim.

- [ ] Implementar requisição **OCSP** (montar OCSPRequest, POST à URL do AIA,
      parsear resposta) com timeout de 10s.
- [ ] Fallback **CRL** (baixar da CRL DP, checar o serial) com o mesmo timeout.
- [ ] Testar com certificado ICP real (bom e revogado) — só então sai o `@pending`.

## 6. Infra de produção (fora do escopo de assinatura, mas necessário)

- [ ] Redis no ar (BullMQ do `signature-validation`).
- [ ] Storage acessível ao worker (`storage.download`: Supabase ou local).
- [ ] Migração das colunas aplicada aos tenants existentes (via `provision.ts`).

---

## Como saber que está "de verdade"

1. `signing:status` → `available:true, tokenPresent:true` (pkcs11js buildado + token).
2. Assinar um PDF no desktop e abri-lo num validador ICP (ex.: Validar/ITI) → OK.
3. Subir esse PDF: `GET /documents/:id/signature` → `valida` (bundle presente,
   cadeia até raiz ICP, revogação consultada).

Enquanto qualquer item de 1–5 estiver aberto, o comportamento **seguro** é:
desktop recusa/avisa graciosamente; API marca `invalida`/`nao_verificada`.
