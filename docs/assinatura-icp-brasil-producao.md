# Assinatura ICP-Brasil — checklist para produção

Consolidação do que o Marco 5b (API, validação de assinaturas já presentes
num PDF enviado) entrega **compilando + com degradação graciosa**, e do que
ainda depende de **bundle oficial ou infra** para funcionar de verdade.

> O Marco 5a (assinar um PDF no desktop com token PKCS#11 físico) foi
> **removido** — nunca chegou a ser exercitado com hardware real e criava
> atrito de build (pkcs11js exige toolchain nativa incompatível com versões
> recentes do Electron). Se a necessidade de assinar (nao so verificar)
> reaparecer, reavaliar com um modulo/versao atualizados.

> Legenda: `[ ]` pendente · `[x]` feito · `@pending` = implementado mas não
> exercitado fim-a-fim (falta bundle/rede real).

---

## Estado atual (o que já está pronto)

- [x] **Validação na API** (`apps/api/src/signature/`): parsing ByteRange/CMS,
  integridade (digest + RSA) **testada**, worker BullMQ, colunas em `documents`,
  `GET /t/:slug/documents/:id/signature`.
- [x] **Unit tests** (4/4): mecânica válida com self-signed; cadeia ICP
  `invalida` — o assert correto sem bundle.

---

## 1. Bundle de raízes ICP-Brasil (API)

`@pending` até o bundle existir — sem ele, **toda cadeia fica `invalida`**.

- [ ] Baixar **manualmente** as ACs Raiz de **https://acraiz.icpbrasil.gov.br**
      (não é automático — decisão de segurança).
- [ ] Colocar os `.pem/.crt/.cer` em `apps/api/certs/icp-brasil/`.
- [ ] (Opcional) apontar `ICP_ROOTS_DIR` para outro diretório.
- [ ] Conferir hash/veracidade dos arquivos antes de confiar.

## 2. Revogação OCSP/CRL (API) — `@pending`

Hoje sempre `nao_verificada` (nunca trava). Falta o protocolo fim-a-fim.

- [ ] Implementar requisição **OCSP** (montar OCSPRequest, POST à URL do AIA,
      parsear resposta) com timeout de 10s.
- [ ] Fallback **CRL** (baixar da CRL DP, checar o serial) com o mesmo timeout.
- [ ] Testar com certificado ICP real (bom e revogado) — só então sai o `@pending`.

## 3. Infra de produção (fora do escopo de assinatura, mas necessário)

- [ ] Redis no ar (BullMQ do `signature-validation`).
- [ ] Storage acessível ao worker (`storage.download`: Supabase ou local).
- [ ] Migração das colunas aplicada aos tenants existentes (via `provision.ts`).

---

## Como saber que está "de verdade"

1. Subir um PDF já assinado por outro sistema: `GET /documents/:id/signature`
   → `valida` (bundle presente, cadeia até raiz ICP, revogação consultada).

Enquanto qualquer item de 1–2 estiver aberto, o comportamento **seguro** é:
API marca `invalida`/`nao_verificada` (nunca trava o upload).
