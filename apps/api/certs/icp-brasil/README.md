# Bundle de raízes ICP-Brasil

Esta pasta guarda os **certificados raiz/âncoras de confiança da ICP-Brasil**
usados pela validação de cadeia das assinaturas (`apps/api/src/signature/`).

## O bundle NÃO é baixado automaticamente

Por decisão de segurança, a aplicação **não faz download automático** de âncoras
de confiança. O operador baixa o bundle oficial **manualmente** e coloca aqui.

- Fonte oficial: **https://acraiz.icpbrasil.gov.br**
  (Cadeia da Autoridade Certificadora Raiz — "Certificados das ACs").
- Baixe os certificados das ACs Raiz (v1..v10 conforme vigência) em formato
  **PEM** ou **DER** e salve nesta pasta (`.pem`, `.crt` ou `.cer`).
- Confira o hash/veracidade do arquivo antes de confiar.

## Como a validação usa este diretório

- No boot, o serviço carrega **todos** os `.pem/.crt/.cer` desta pasta como
  âncoras de confiança (trust anchors).
- Intermediárias ausentes são buscadas via **AIA** (caIssuers) do próprio
  certificado, com timeout.
- **Sem bundle presente, nenhuma cadeia alcança uma raiz ICP-Brasil** → toda
  assinatura fica `invalida` na etapa de cadeia (comportamento correto e seguro).

## Pendências (@pending)

Sem o bundle oficial e sem um PDF assinado por token ICP real, a validação de
**cadeia** e de **revogação (OCSP/CRL)** não pôde ser exercitada fim-a-fim.
A mecânica de **integridade** (ByteRange + CMS + RSA) é testada com certificado
self-signed nos unit tests.
