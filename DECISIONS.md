# DECISIONS.md — jDoc

Registro de decisões de arquitetura e segurança. Quando algo é ambíguo, a opção mais segura vence.

## Fase 1

| # | Decisão | Motivo |
|---|---------|--------|
| 1 | **Drizzle + postgres.js** (não Prisma) | `search_path` fixado por conexão dedicada é nativo no postgres.js; schema dinâmico por tenant não depende de client gerado por schema estático. Queries 100% parametrizadas via tagged templates. |
| 2 | **CommonJS em todos os pacotes backend** | NestJS é CJS; evita dor de interop ESM/CJS no monorepo. Web (Next) usa bundler resolution própria. |
| 3 | **Nome de schema NUNCA interpolado cru** | Derivado de slug validado (`tenantSlugSchema`) → `schemaNameForSlug` → re-validado com `^tenant_[a-z0-9_]{2,30}$`. `sql.unsafe` só recebe identificador pós-allowlist `[a-z0-9_]`. Identificador não é parametrizável por bind no Postgres — allowlist é a defesa correta. |
| 4 | **Pool dedicado por tenant com `search_path` na conexão** | Fixado na criação da conexão (não por `SET` por query) — impossível query de negócio enxergar outro schema. Pools cacheados por schema. |
| 5 | **RBAC deny-by-default estrito** | Rota autenticada SEM `@Permissions` declarado = 403. Obriga declaração explícita em toda rota nova — esquecimento falha fechado, não aberto. |
| 6 | **Refresh token opaco (não JWT) no Redis** | Formato `familyId.segredo256bit`; Redis guarda apenas SHA-256 do segredo. Rotação mantém família; reuso de segredo antigo = família inteira revogada + log de segurança global. |
| 7 | **Login em tempo ~constante** | Argon2id roda contra hash dummy quando usuário não existe — mitiga enumeração por timing. Mensagem de erro única ("E-mail ou senha invalidos"). |
| 8 | **Superadmin sem TOTP configurado NÃO loga** | 2FA obrigatório de verdade: seed provisiona o secret; sem `totp_enabled` o login falha com mensagem genérica. Mais seguro que permitir primeiro login sem 2FA. |
| 9 | **Realms 100% separados** | Tabelas separadas (`public.superadmins` vs `users` no schema do tenant), issuer/audience JWT distintos, cookies com paths distintos (`/t/<slug>/auth` vs `/superadmin/auth`), guards distintos. |
| 10 | **Cookie refresh escopado por path** | `path=/t/<slug>/auth` — browser não envia o cookie de um tenant para rotas de outro tenant nem para o superadmin. |
| 11 | **Tenant inexistente = 404 genérico** | Não vaza existência de órgãos. Inativo = 403 "Órgão suspenso, contate a JEOS" (exigência do prompt). |
| 12 | **Access token só em memória no front** | Nunca `localStorage`/`sessionStorage` (mitiga XSS exfil). Refresh via cookie httpOnly. |
| 13 | **CSP da API `default-src 'none'`** | API REST não serve HTML; política mais restritiva possível. CSP do front tratada no Next. |
| 14 | **Auditoria best-effort com alerta** | Falha ao gravar audit log não derruba o request de negócio, mas é logada como erro no servidor. Trade-off documentado: disponibilidade > atomicidade do log na Fase 1. |
| 15 | **Allowlist de IP do superadmin vale para TODAS as rotas do realm** | Inclusive login — aplicada no guard antes do check de `@Public`. |

## Fase 2

| # | Decisão | Motivo |
|---|---------|--------|
| 16 | **Uso de disco = soma `pg_total_relation_size` do schema** | Fase 2 não tem arquivos ainda (Storage entra na Fase 3); tamanho do schema é a métrica disponível e já cobre "estimativa do schema" exigida. Na Fase 3 soma-se o total de bytes de arquivos. |
| 17 | **Reset de senha / desativação de usuário revoga TODAS as sessões** | `revokeAllForUser` no Redis — sessão antiga não sobrevive a credencial trocada/conta desativada. |
| 18 | **Toda mutação do superadmin grava `global_audit_logs`** | tenant_created/updated/activated/deactivated/quota_changed, tenant_user_created/password_reset/(de)activated — exigência de log global de ações de superadmin. |
| 19 | **Filtros de logs com predicados `IS NULL OR` parametrizados** | Evita SQL dinâmico por concatenação; tudo bind. |
| 20 | **Dashboard tolera schemas sem `documents`** | `to_regclass` checa existência antes de contar — tabela só nasce na Fase 3. |

## Fase 3

| # | Decisão | Motivo |
|---|---------|--------|
| 21 | **Storage com fallback local (HMAC signed URL 60s)** | Sem Supabase em dev, storage vai pra filesystem com URL assinada HMAC servida por `/files/:slug/:key?exp&sig` — mesma semântica de expiração das signed URLs do Supabase, o que permite testar "URL expirada = 403" localmente. Produção: bucket privado `jdoc-<slug>` no Supabase. |
| 22 | **`file_key` = UUID.pdf validado por regex estrita** | Nome de arquivo NUNCA vem do usuário; nome original é só metadado. Allowlist `^uuid\.pdf$` em todo caminho de storage (anti path-traversal). |
| 23 | **Quota conta TODOS os arquivos, inclusive lixeira** | Soft-deleted ainda ocupa disco — contar só ativos permitiria estourar a quota via lixeira. |
| 24 | **RBAC dinâmico por módulo nos documentos** | Rotas compartilham handler entre 5 módulos; permissão `${module}:${action}` é checada no service (`assertPermission`). Rotas usam `@Permissions()` (autenticação) + checagem dinâmica — documentado para não parecer esquecimento. |
| 25 | **Purge da lixeira acontece no acesso à lixeira** | Itens com `deleted_at > 30 dias` são removidos (arquivo + linha) quando a lixeira é listada — sem cron na Fase 3; job dedicado entra na Fase 7 com BullMQ. |
| 26 | **`budget_unit_id` opcional na Fase 3** | CRUD de unidades orçamentárias só chega na Fase 6; obrigar vínculo agora bloquearia uso. Seed cria 3 unidades demo. Validação endurece na Fase 6. |
| 27 | **Magic bytes `%PDF` no servidor, MIME do cliente ignorado** | Testado: `.pdf` com conteúdo não-PDF é rejeitado com 400. |

## Pendências conhecidas (Fase 1)

- Docker Desktop instável na máquina de dev — testes e2e de isolamento escritos (`apps/api/test/isolation.e2e-spec.ts`), rodam quando a infra local subir.
- ~~Rate limiting por rota/IP: fecha na Fase 7 (hardening) — brute-force progressivo já cobre login.~~ **Fechado na Fase 7a** (decisões #39–#43).
- Checagem de senhas vazadas comuns: lista local a integrar na Fase 6/7.

## Fase 7a — Hardening parcial

> Escopo aprovado por esta tarefa: throttler global + `@Throttle` em rotas críticas
> (login/upload/relatórios) e teste e2e provando HTTP 429. Senhas vazadas comuns,
> 2FA confirm, recover e alinhamento de semântica no storage ficam para iteração futura.

| # | Decisão | Motivo |
|---|---------|--------|
| 39 | **Throttler global via `@nestjs/throttler` (60/min/IP default)** | Defesa em profundidade contra brute-force, scraping e abuso de relatórios; backstop ao bloqueio progressivo por conta já implementado na Fase 1. Variáveis `THROTTLE_*` no `.env` permitem ajuste sem deploy. |
| 40 | **Override por rota nos pontos quentes** | Login = 5/min (alvo de brute-force); refresh = 30/min; 2FA confirm = 10/min; logout = 30/min. Upload PDF = 20/min (evita exaustão de quota + storage). Geração de relatório = 5/min (workers BullMQ caros). Listagens/demais documentos = default. |
| 41 | **`/health` isento de throttling** | Probe do load balancer / container: nunca deve retornar 429. `skipIf: () => req.url === '/health'` no `ThrottlerModule.forRoot()`. |
| 42 | **Storage único no Redis já existente** | Reutiliza `REDIS_URL` (Fase 1) — sem novo componente de infra. `storage: redis` aceito pelo `@nestjs/throttler` v6+ sem adapter extra. |
| 43 | **Teste e2e `throttler.e2e-spec.ts` prova HTTP 429 real** | Dispara 6 logins com senha errada (limite = 5); 6ª chamada = 429. Garante que o throttler está plugado na cadeia do Nest, não só em código morto. |

### Itens restantes da Fase 7a (NÃO fechados nesta iteração)
- Checagem de senhas vazadas comuns (integração da lista local).
- Cobertura adicional: `2FA confirm`, recover e MFA quando entrar.
- Inconsistência semântica entre `LocalFilesController` (Fase 3) e `BackupsFilesController` (Fase 4): URL expirada = 403 no primeiro, 400 no segundo — alinhar para 403.

## Fase 4 — Etiquetas (SS / ASPEC / JBS)

> Nota: uma implementação paralela de parsers (`src/labels/parsers/`) foi descartada em favor de
> `packages/shared/src/parsers/` (decidido com o usuário). Tabela abaixo reflete o que está implementado.

| # | Decisão | Motivo |
|---|---------|--------|
| 28 | **Parsers como funções puras (`parseX(content, module): ParseResult`)** | Zero I/O, zero efeito colateral. Mesma função roda no front (preview) e no back (validação + worker). Testadas com 17 testes unitários (vitest). |
| 29 | **Tipo canônico `ParsedRecord`** (module, docCaixa, empenho, credor, valor, data ISO, historico) | SS/ASPEC/JBS são dialetos; consumidor não vê peculiaridades de formato. |
| 30 | **Layouts definidos e documentados no código** (specs reais dos exportadores não fornecidas) | SS = CSV `;` com data DD/MM/AAAA e valor brasileiro; ASPEC = posicional (colunas fixas, mín. 87 chars); JBS = CSV `|` com data ISO e valor decimal ponto. Ajustar parsers quando amostras reais chegarem — interface `ParseResult` não muda. |
| 31 | **Auto-detect por heurística + dropdown de override manual** | `detectFormat`: `\|` em todas as linhas → JBS; `;` → SS; linhas ≥87 sem separador → ASPEC; senão `null` → usuário seleciona. |
| 32 | **Arquivo de etiqueta (TXT/CSV ≤ 2 MB) guardado em `labels_imports.file_content` (coluna text)** | Worker reprocessa da fonte sem re-upload; arquivos são pequenos (texto). Rejeita binário (byte 0x00). Storage/Supabase reservado para PDFs. |
| 33 | **Estrutura dupla: `labels_imports` (1/arquivo) + `labels` (N/registro, FK cascade)** | Rastreabilidade total: contadores + `relatorio_erros` jsonb no import; registros normalizados com `document_id` nullable para vínculo futuro com PDF. |
| 34 | **Só registros válidos são importados; erros ficam no relatório** | Preview mostra erros linha a linha ANTES de confirmar; import sem nenhum registro válido = 400. Opção mais segura por default. |
| 35 | **Fila BullMQ (`labels-import`) com concurrency=2, worker no mesmo processo** | Import não trava HTTP; worker valida `SCHEMA_NAME_REGEX` do job antes de qualquer query (regra de ouro fora do request). Destacável em processo próprio na Fase 7. |
| 36 | **Polling 1,2s no modal até `concluido`/`erro`** | SSE/WebSocket fora de escopo; polling simples cobre a UX. |
| 37 | **Permissão exigida: `${module}:create` (module vem do multipart, aba define)** | Importação é criação em massa. `consulta` barrado (testado e2e). |
| 38 | **jsonb sempre via `sql.json()`** | `JSON.stringify` como bind vira string dupla-encodada no jsonb (bug real encontrado no e2e). Parse defensivo na leitura. |
