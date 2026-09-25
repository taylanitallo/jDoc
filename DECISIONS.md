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

## Arquivo Municipal — Etapa 1: Plano de Classificação + Tabela de Temporalidade

> Objetivo: gestão arquivística (CONARQ / e-ARQ Brasil) para uso do jDoc pelo Arquivo Municipal.
> Plano completo das etapas seguintes: Acervo genérico, OCR/busca no conteúdo, autenticidade pública (QR),
> arquivo físico e eliminação legal.

| # | Decisão | Motivo |
|---|---------|--------|
| 44 | **Classe sem prazos/destinação = agrupadora; documento só recebe classe com TTD completa** | Espelha o Código de Classificação: grupos (000, 050…) organizam, subclasses têm prazo. Evita documento "classificado" sem prazo nenhum. |
| 45 | **Listas da TTD calculadas na consulta (`current_date`), sem job diário** | Prazos ficam gravados no documento; "a transferir/eliminar/recolher" é comparação de data. Sempre atual, sem fila nem estado derivado para dessincronizar. |
| 46 | **Prazos recalculados em SQL no servidor; `calcularPrazos()` (shared) só para preview no front** | Mudar a TTD de uma classe recalcula milhares de documentos numa única UPDATE. Soma de anos em duas etapas (corrente, depois intermediário) para bater com a função JS em 29/02 — coberto por teste unitário e verificado no banco. |
| 47 | **Classe padrão por módulo financeiro (`tenant_settings.classificacao_padrao_por_modulo`)** | Operador de receitas/despesas não precisa conhecer arquivística; documento nasce classificado. Botão "aplicar classe padrão" cobre legado e etiquetas importadas. |
| 48 | **Modelo base carregado sob demanda, só com plano vazio; prazos incertos sugerem guarda permanente** | Não sobrescreve plano do órgão. Os prazos são sugestão a ser aprovada pela CPAD; errar para o lado da preservação nunca destrói documento. |
| 49 | **Transferência/recolhimento só de documentos com prazo vencido, com guia numerada por tipo/ano** | Sem antecipação de prazo pela API. Numeração serializada com `pg_advisory_xact_lock`; guia em PDF com linhas de assinatura (entrega/recebimento). |
| 50 | **Documento fora da fase corrente não vai para a lixeira** | Transferido/recolhido é registro oficial; sai do acervo só pelo fluxo legal de eliminação (Etapa de eliminação). Na fase corrente a lixeira continua valendo para erro de cadastro. |
| 51 | **Classe em uso nunca é apagada, só inativada** | Preserva o histórico da classificação dos documentos já arquivados. |
| 52 | **CSV da TTD com `;`, BOM e neutralização de fórmula (`=+-@`)** | Abre direto no Excel com acentos; evita injeção de fórmula ao exportar descrições digitadas por usuário. Importação valida todas as linhas antes de gravar. |
| 53 | **Lista de classes aberta a qualquer autenticado; mutações exigem `classificacao:*` / `temporalidade:*`** | Os modais de inclusão precisam listar classes; conteúdo não é sensível. Novos módulos RBAC entram em `MODULES` e na matriz de permissões da tela de usuários. |

### Pendências conhecidas (fora desta etapa)
- e2e antigos desatualizados em relação ao código (não relacionados a esta etapa): `configuracoes.e2e-spec.ts` (unidade sem `orgaoId`, espera 200 onde o controller devolve 204) e `reports.e2e-spec.ts` (`tipoData: 'producao'`/`relatorio: 'detalhado'` não existem mais no schema).
- ~~`pnpm-lock.yaml` fora de sincronia~~ **Corrigido:** não era problema do repo — o install tinha sido feito com pnpm 9; o projeto fixa `pnpm@11.9.0` (`packageManager`). Com a versão certa o lockfile bate e o typecheck da API fica sem erros (inclusive `ioredis`/backups).

## Arquivo Municipal — Etapa 3: Módulo Acervo

| # | Decisão | Motivo |
|---|---------|--------|
| 54 | **Acervo = novo `DOC_MODULE` reaproveitando todo o fluxo de documentos** | Upload seguro, lixeira, extras, assinatura, conferência, busca e temporalidade vêm de graça; nada de segundo caminho de upload para auditar. |
| 55 | **Metadados definidos no Tipo de Documento (`document_types.campos`), valores em `documents.metadados` jsonb** | Arquivo Municipal tem dezenas de espécies documentais; coluna por campo não escala. Tipos `texto`, `texto_longo`, `numero`, `data`, `selecao`, valores sempre string. |
| 56 | **Validador gerado a partir dos campos (`metadadosSchemaFor`) e estrito** | Mesmo código no front e no back; chave fora da definição = 400 (sem mass assignment no jsonb). Validação acontece ANTES do upload para erro não deixar PDF órfão no storage. |
| 57 | **Mudar campos do tipo não reescreve documentos antigos** | Valores de chaves removidas ficam no jsonb como histórico; chave de campo existente não é regerada ao renomear o rótulo. Tipo com documentos não troca de módulo. |
| 58 | **Tipo define classe e nível de acesso padrão** | "Ficha Funcional" nasce restrita e na classe 020.1 sem o operador lembrar. Escolha explícita no modal prevalece. |
| 59 | **Nível `restrito` filtrado no servidor em toda leitura** | Busca, lixeira, ZIP em lote, exclusão em lote e toda operação por id (`getRowFor`) exigem admin ou `acervo_restrito:read`. Sem permissão = 404, não revela que o documento existe. Vale para qualquer módulo, não só Acervo. |
| 60 | **Lookup `/document-types` sem filtro devolve só `outros`** | Compatibilidade com o jDoc Desktop e telas antigas; Acervo pede `?modulo=acervo`. Acervo não aparece no Desktop (formulário dinâmico só no web por ora). |
| 61 | **Busca livre inclui `metadados::text` com índice trigram** | "participativo", "777" (matrícula) etc. acham o documento sem filtro específico por campo. |
| 62 | **Metadados de digitalização do Decreto 10.278/2020 no documento** | `digitalizado`, responsável, data e local — junto com hash, classe, tipo, datas e destinação cobrem o Anexo II. |

### Observação
- Temporalidade: listas mostram a descrição de documentos restritos para quem tem `temporalidade:read` (o arquivista precisa ver o que vai transferir/eliminar). O arquivo em si continua protegido.

## Arquivo Municipal — Etapa 4: Busca no conteúdo (texto + OCR)

| # | Decisão | Motivo |
|---|---------|--------|
| 63 | **`pdftotext` primeiro, OCR (`pdftoppm` + `tesseract -l por`) só nas páginas sem texto** | PDF nascido digital não gasta CPU com OCR; escaneado é lido página a página. Testado em container Linux com página só-imagem: texto com acentos extraído corretamente. |
| 64 | **PDF original nunca é alterado; texto vai para `document_textos` (1 linha por página)** | Hash SHA-256 e assinatura ICP-Brasil continuam válidos. Página guardada permite abrir o PDF direto na página encontrada (`#page=N`). |
| 65 | **Acentos removidos em Node antes de indexar e consultar (`normalizarParaBusca`)** | O pool do tenant tem `search_path` só no schema do tenant (extensão `unaccent` em `public` ficaria invisível) e `unaccent` não é IMMUTABLE. Mesma função no índice e na consulta = "contratacao" acha "contratação". |
| 66 | **Trecho destacado montado em segmentos `{texto, destaque}`, nunca HTML** | Front renderiza sem `dangerouslySetInnerHTML`; texto de OCR é conteúdo não confiável. Destaque por prefixo acompanha o stemming português. |
| 67 | **Feature liga sozinha se o ambiente tem poppler; `OCR_DISABLED=1` força desligar** | Dev no Windows sem tesseract continua funcionando (upload não depende da indexação). Dockerfile da API instala `poppler-utils tesseract-ocr tesseract-ocr-por`. |
| 68 | **Worker `document-ocr` com concurrency 1, 2 tentativas, teto de 300 páginas OCR por arquivo e timeouts** | OCR é CPU-bound e roda no mesmo processo da API; PDF gigante não trava o servidor. Binários via `execFile` (sem shell) em diretório temporário próprio, nomes de arquivo fixos. |
| 69 | **Job confere se o arquivo ainda é o mesmo (`file_key`) antes de gravar** | Se o PDF foi removido/substituído enquanto o job esperava, o texto velho não volta pra busca. Remover/substituir PDF apaga o texto na hora. |
| 70 | **Busca respeita RBAC por módulo e nível de acesso no servidor** | Rota só exige autenticação; o service filtra módulos com `${modulo}:read` e documentos restritos (decisão #59). Mesmo filtro vale para a ferramenta `buscar_conteudo` do Assistente IA. |
| 71 | **Reindexação de legado sob demanda, só admin, lote de 2000 e throttle 3/min** | Acervo existente antes da feature é indexado sem job diário e sem encher a fila de uma vez. |

## Arquivo Municipal — Etapa 5: Autenticidade pública (cópia autenticada + QR)

| # | Decisão | Motivo |
|---|---------|--------|
| 72 | **Cópia autenticada gerada em memória a cada emissão; original no storage intocado** | Carimbo (órgão, datas, código, trecho do SHA-256, QR) numa faixa no rodapé de cada página via pdf-lib. O original mantém hash e assinatura ICP-Brasil; a cópia é uma representação para circular. |
| 73 | **Código = 80 bits aleatórios em 16 caracteres Crockford base32, um por versão do arquivo** | Não sequencial, não enumerável, fácil de digitar (sem I/L/O/U; entrada normaliza O→0, I/L→1). Reemitir a cópia do mesmo arquivo reusa o código; PDF substituído gera código novo e o antigo responde "substituído". |
| 74 | **Códigos e hashes das cópias no catálogo global (`public.codigos_verificacao`, `public.copias_autenticadas`)** | Verificação pública acha o órgão sem varrer schemas; schema do tenant é derivado do slug do catálogo (validado), nunca da URL. |
| 75 | **Verificação pública devolve só metadados mínimos** | Órgão, tipo documental, datas, hash, situação (vigente/substituído/excluído/eliminado), status da assinatura e nº de cópias. Nunca título, descrição, conteúdo, id interno ou arquivo — nem de documento público (portal LAI é outra etapa). |
| 76 | **"Confira seu arquivo": hash calculado no navegador (WebCrypto), só o hash vai ao servidor** | O PDF do cidadão nunca sai da máquina dele. O hash da própria cópia carimbada é registrado na emissão, então quem recebeu a cópia confere que ela saiu do sistema sem alteração. |
| 77 | **Rotas públicas `/public/verificar` fora do realm do tenant, throttle 20/min/IP, 404 idêntico para código inexistente e malformado** | Sem pista para enumeração; órgão suspenso continua verificável (autenticidade não depende do contrato ativo). |
| 78 | **Emissão exige leitura do módulo e respeita nível restrito (`arquivoParaCopia` reusa `getRowFor`)** | Mesmas regras do download; restrito sem permissão = 404. Cada emissão é auditada com código, hash do original e hash da cópia. |
| 79 | **Slugs reservados (`verificar`, `superadmin`, `public`, `api`, `t`, `login`, `files`) bloqueados só na criação de órgão** | Evita órgão colidir com rota pública do front; slugs existentes continuam válidos. |
| 80 | **PDF criptografado/ilegível = 422 com mensagem clara** | pdf-lib pode aceitar arquivo corrompido no load e falhar depois; qualquer erro do carimbo vira `PdfNaoCarimbavelError`. |

## Arquivo Municipal — Etapa 6: Arquivo físico

| # | Decisão | Motivo |
|---|---------|--------|
| 81 | **Árvore única de locais (`predio > sala > estante > prateleira > caixa`) com hierarquia validada no servidor** | Tipo menor nunca contém tipo maior (`podeConter`); mover local checa ciclo (CTE recursiva) e, ao trocar o tipo, se os filhos continuam cabendo. Código único por nível (`UNIQUE NULLS NOT DISTINCT (parent_id, tipo, codigo)`). |
| 82 | **Documento aponta para o local do original (`local_fisico_id` + `possui_original_fisico`)** | Vincular à caixa marca que existe papel. Busca por documento → onde está; caixa → o que tem dentro. |
| 83 | **Local com conteúdo, sublocais ou histórico de empréstimo só é inativado** | Termos e espelhos antigos continuam apontando para algo que existe. |
| 84 | **Etiqueta de caixa (150×100 mm) com QR para a tela interna autenticada** | Ler o QR abre `/<slug>/arquivo-fisico?local=<id>` — só quem tem login no órgão vê o conteúdo; a etiqueta colada na caixa não expõe nada publicamente. |
| 85 | **No máximo um empréstimo aberto por documento e por caixa, garantido por índice único parcial** | Evita dois termos para o mesmo papel mesmo com cliques simultâneos; numeração anual serializada por advisory lock. Atraso é calculado na consulta (`prazo < current_date`). |
| 86 | **Empréstimo de documento exige original físico cadastrado e respeita nível restrito** | Não se empresta o que não existe em papel; ficha restrita não aparece nem pode ser emprestada por quem não pode vê-la. Conteúdo/espelho da caixa mostram só a contagem dos restritos ocultos. |
| 87 | **Termo de empréstimo em PDF com cláusula de integridade e duas assinaturas** | Formaliza a saída do documento do arquivo (responsabilidade do solicitante). |

## Arquivo Municipal — Etapa 2: Eliminação legal (Resolução CONARQ nº 40/2014)

| # | Decisão | Motivo |
|---|---------|--------|
| 88 | **Fluxo em estados fixos: rascunho → aprovada (CPAD) → edital publicado → concluída; cancelável até concluir** | Cada passo exige o anterior; transições com `SELECT … FOR UPDATE` na eliminação. Itens só mudam em rascunho. |
| 89 | **Só entra na listagem documento na lista "A eliminar" e fora de outra listagem ativa** | Reusa o mesmo filtro da TTD (`LISTA_WHERE.a_eliminar`): destinação eliminação + prazo total vencido + fase corrente/intermediária. Guarda permanente nunca entra. |
| 90 | **Aprovação exige ata, data e ao menos 2 membros da CPAD; edital não antes da aprovação** | Comissão é colegiada; os nomes vão no edital e nas linhas de assinatura do termo. |
| 91 | **Conclusão só após publicação + prazo do edital (padrão 45 dias, mínimo 30), só admin (`temporalidade:delete` + papel admin), com frase digitada `ELIMINAR 003/2026` e throttle 3/min** | Irreversível: várias travas independentes contra clique acidental ou permissão mal dada. |
| 92 | **Na conclusão tudo é revalidado dentro da transação; qualquer item inelegível ou emprestado aborta tudo** | Classe/prazo podem ter mudado desde a listagem; papel emprestado não pode ser destruído. Nada é eliminado parcialmente — cancela-se e monta-se nova listagem. |
| 93 | **Registro permanente antes de apagar: nome + SHA-256 de cada arquivo (principal e extras), classe, descrição, datas e caixa no item da eliminação** | Prova de que o documento existiu e foi eliminado regularmente. Documento fica `fase = eliminado`, sem arquivo, somente leitura (anexar/editar = 400). Verificação pública responde "eliminado". |
| 94 | **PDFs apagados só DEPOIS do commit, com `deleteStrict` (erro do provedor é falha, não silêncio)** | Se o banco falhar, nenhum arquivo some. Se o storage falhar depois, o documento já consta eliminado e a chave órfã vai para a auditoria (`falhasStorage`) para limpeza — nunca "diz que apagou" sem apagar. |
| 95 | **Documentos oficiais em PDF: Listagem (sintética por classe + analítica), Edital de Ciência e Termo de Eliminação com anexo de destruição dos originais em papel (por caixa, com checkbox) e anexo de hashes** | Cobre o que a Resolução CONARQ 40 pede e o que o Arquivo Municipal precisa para destruir o físico. |

### Nota de testes
- Specs e2e novos limpam o cache Redis `tenant:slug:*` no `beforeAll`: recriar tenant com o mesmo slug dentro de 60 s deixava o `tenant_id` antigo em cache (FK de `codigos_verificacao` falhava). Artefato de teste; em produção um slug não é apagado e recriado em segundos.

## Separação em dois módulos contratáveis: Financeiro/Contábil e Arquivo

| # | Decisão | Motivo |
|---|---------|--------|
| 96 | **`public.tenants.modulos` (`financeiro` e/ou `arquivo`, ao menos um, CHECK no banco); superadmin liga/desliga por órgão** | Arquivo Municipal pode contratar só o Arquivo; prefeitura só o Financeiro ou os dois. Órgãos existentes ficam com `{financeiro}` (Arquivo é contratado à parte). |
| 97 | **API barra, o menu só esconde: `@RequerSistema()` + `SistemaGuard` nos controllers de cada módulo e `assertSistema()` no RBAC dinâmico por módulo de documento** | Módulo não contratado = 403 "Módulo X não contratado", inclusive para admin. Rotas comuns (busca, assistente, cópia autenticada/verificação, configurações, usuários) não têm marca e servem aos dois. |
| 98 | **Com os dois módulos, integrados: documento financeiro recebe classificação/temporalidade; só Financeiro, a arquivística nem roda** | `aplicarAoDocumento` é no-op sem Arquivo — sem classe, sem prazos, nada de arquivística nos modais. Busca no conteúdo só procura em módulos contratados. |
| 99 | **Módulos vão no contexto do tenant (cache de 60 s invalidado na edição pelo superadmin) e no `/branding`** | Menu (seções FINANCEIRO/CONTÁBIL, ARQUIVO, GERAL), abas de Configurações, matriz de permissões e dashboard mostram só o contratado. Entrada de cache antiga sem o campo = só financeiro. |
| 100 | **Desligar módulo não apaga dados** | Telas e API ficam indisponíveis; religar devolve tudo. Aviso explícito no modal do superadmin. |

## Correções encontradas no teste em navegador

| # | Decisão | Motivo |
|---|---------|--------|
| 101 | **Rotação do refresh token atômica (script Lua) com janela de 20 s para o token recém-substituído** | Bug real: dois refresh simultâneos (duas abas, F5 no meio de uma requisição, StrictMode) liam o mesmo hash e ambos rotacionavam; o navegador guardava um cookie e o Redis outro, e o F5 seguinte era tratado como "reuso" e derrubava a sessão. Agora o concorrente recebe o MESMO token novo. O token novo fica no Redis cifrado (AES-256-GCM) com chave derivada do segredo antigo — o Redis continua sem token utilizável em claro. Fora da janela, segredo antigo = reuso = família revogada (regra original mantida). Coberto por teste contra Redis real. |
| 102 | **Bootstrap de sessão pelo mesmo single-flight do refresh automático (`bootstrapSession`)** | Os layouts chamavam o refresh direto; com o efeito duplicado do React disparavam duas requisições. Defesa nos dois lados. |
| 103 | **Nome de Tipo de Documento único por módulo (`UNIQUE (modulo, nome)`); duplicado = 409 com mensagem** | "Criar tipos prontos" do Acervo dava 500 quando já existia "Contrato"/"Decreto" em Outros Arquivos. |
| 104 | **e2e antigos de `configuracoes` e `reports` alinhados à API atual** | Órgão → unidade; projeto/elemento por exercício; PATCH = 204; `tipoData: 'documento'`; prestação de contas gera PDF (não ZIP). Suíte completa: 14 arquivos / 109 testes verdes. |

## Layout, separação visual dos módulos e preparação para deploy

| # | Decisão | Motivo |
|---|---------|--------|
| 105 | **Design System próprio (Tailwind v4 com tokens em `@theme`, componentes em `components/ui`, sem biblioteca externa)** | Padrão de layout definido pelo cliente: tokens brand/ink/surface/canvas/success/warning/danger (+ info, orange, violet, teal, pink), tema escuro pela classe `.dark`, AppShell com sidebar 264/76 px e gaveta no celular. |
| 106 | **Módulo ativo no front (`ModuloAtivoProvider`): com os dois módulos contratados, tela de escolha após o login e seletor no menu; cada módulo tem menu, Início, busca e abas de Configurações próprios** | Pedido do cliente: Arquivo Municipal e Financeiro/Contábil separados na experiência. A rota define o módulo (abrir `/acervo` ativa o Arquivo); a última escolha fica no navegador. Busca aceita `sistema` para não misturar resultados. Com um módulo só, nada disso aparece. |
| 107 | **`SelectMenu` substitui os `<select>` nativos, mantendo um `<select>` escondido que recebe o valor e dispara `change` real** | A lista nativa do Windows não pode ser estilizada (e o Electron 33 não suporta `appearance: base-select`). O select escondido mantém react-hook-form, `defaultValue` e `e.target.value` funcionando sem reescrever os formulários. Lista em portal com `z-[120]` (acima do Modal) e Esc que não fecha o Modal. |
| 108 | **Documento do Acervo nasce `restrito`; tipos do Acervo (novos e prontos) nascem restritos; Financeiro continua `publico`** | Pedido do cliente. Restrito só aparece para admin ou `acervo_restrito:read` — aplicar ao Financeiro esconderia despesas dos operadores. A API aplica o padrão mesmo sem o campo; o formulário avisa quem não pode ver restritos que o documento sumirá para ele. |
| 109 | **Excluir tipo de documento é definitivo e bloqueado (409) se houver qualquer documento vinculado, inclusive na lixeira** | Corrigir tipo criado errado sem perder referência de documentos; antes o "excluir" só inativava, sem checagem. |
| 110 | **Sessão: refresh com timeout de 15 s e tela "Não foi possível conectar / Tentar novamente"** | A tela ficava em "Carregando…" para sempre quando a API não respondia. Sessão expirada continua indo para o login. |
| 111 | **`.dockerignore` na raiz; e2e força `DIRECT_URL = DATABASE_URL` de teste** | Sem `.dockerignore`, o build local copiava `node_modules` do Windows (quebrava o build) e `apps/api/.storage` (arquivos enviados) para a imagem. O e2e herdava `DIRECT_URL` do `.env` e provisionava schemas de teste no banco de desenvolvimento. |

## Funções essenciais do Arquivo Municipal

| # | Decisão | Motivo |
|---|---------|--------|
| 112 | **Verificação de integridade rotativa: job diário (03:30) confere até 2.000 arquivos com mais de 30 dias desde a última conferência; "Verificar agora" manual; divergência/ausência vira ocorrência (uma aberta por arquivo) até tratamento registrado** | Preservação digital (e-ARQ Brasil / Decreto 10.278): o SHA-256 já era gravado no upload, mas nunca reconferido. Rotativa evita baixar o acervo inteiro toda noite e garante ciclo mensal. "Ausente" só após segunda tentativa (falha de rede não vira alarme). Arquivo restaurado fecha a ocorrência sozinho. Só roda para órgãos com o módulo Arquivo, mas confere todos os documentos do órgão. |
| 113 | **Relatórios do Arquivo: inventário (paginado + PDF/CSV), quantitativos (fase, classe, tipo, módulo, exercício) e inventário topográfico; exportação exige `acervo:export` e é auditada; limite de 20.000 linhas por arquivo** | Mesmas regras de visibilidade da busca (módulo sem read não aparece, restrito só com permissão, lixeira nunca, eliminados só quando pedidos). CSV com BOM, `;` e neutralização de fórmulas (`=`, `+`, `-`, `@`) contra injeção ao abrir no Excel. Tabela em PDF reutilizável (`common/exportacao.ts`). |
| 114 | **Acervo aceita exercício desde 1800 e não filtra pelo ano do topo; o seletor de exercício some no módulo Arquivo** | Bug encontrado: o Acervo listava só o exercício selecionado (últimos 8 anos) e a validação barrava anos < 2000 — leis e fichas históricas eram invisíveis ou impossíveis de cadastrar. No Acervo o exercício acompanha a data do documento e é filtro opcional. |
| 115 | **Envio em lote no navegador reaproveitando `POST /documents` (2 envios simultâneos, renovação de sessão em 401, até 300 PDFs), com planilha CSV opcional e planilha-modelo gerada do tipo documental** | Sem endpoint novo: cada arquivo passa pela mesma validação, hash, OCR e auditoria da inclusão individual. Casamento linha↔PDF pelo nome normalizado; pendências (campo obrigatório, data) ficam retidas e não são enviadas. Lógica pura em `shared/lote.ts` com testes. CSV (não XLSX) para não adicionar dependência: o Excel salva CSV. |
| 116 | **Atendimento e consultas (LAI): protocolo sequencial por ano (advisory lock), prazo de 20 dias prorrogável uma vez por 10 com justificativa, indeferimento com fundamentação (mín. 20 caracteres), concluído imutável, comprovante em PDF** | Lei 12.527/2011 arts. 11 e 15. Documento restrito só entra por quem pode vê-lo (quem não pode recebe o mesmo erro de "não existe") e exige justificativa da autorização; na listagem de quem não vê restritos o título aparece como "Documento restrito". Histórico "quem consultou este documento" pelo filtro `documentId`. |
| 117 | **Novos módulos RBAC `integridade` e `atendimento` (Arquivo); mensagens de validação de metadados com acento** | Permissões granulares no padrão existente (`modulo:acao`); relatórios reaproveitam `acervo:read/export` e `arquivo_fisico:read`. |

## Arquivo Municipal de referência: sigilo, dossiês e descrição

| # | Decisão | Motivo |
|---|---------|--------|
| 118 | **Classificação de sigilo da LAI por Termo de Classificação de Informação (TCI) numerado por ano: graus reservado (5 anos), secreto (15), ultrassecreto (25) e informação pessoal (art. 31, 100 anos), hipótese legal obrigatória (art. 23 I–VIII ou art. 31), razões (mín. 20 caracteres) e autoridade classificadora** | Lei 12.527/2011 arts. 23, 24, 27, 28 e 31 e Decreto 7.724/2012. Classificar força o documento para restrito e guarda o nível anterior; um termo vigente por documento (índice único parcial). Nível de acesso de documento classificado só muda pela desclassificação. Prazo conta da data de produção (29/02 cai em 28/02). |
| 119 | **Desclassificação com motivo registrado; expiração automática (job diário 00:20 e também na leitura) devolve o nível de acesso anterior; rol anual das informações classificadas e desclassificadas em PDF (art. 30)** | O acesso volta sozinho no fim do prazo, sem depender de alguém lembrar. Quem não vê restritos vê o termo sem título nem razões. Novo módulo RBAC `sigilo`. |
| 120 | **Dossiês e processos: conjunto com ordem de juntada, desentranhamento com motivo, encerramento, reabertura e apensação de um nível; histórico de atos e capa + índice + termo de encerramento em PDF** | e-ARQ Brasil (documento arquivístico composto). Documento juntado assume a classe do conjunto; a temporalidade conta do ENCERRAMENTO (do principal, para apensos) e fica suspensa enquanto aberto. Transferência, recolhimento e eliminação levam o conjunto inteiro (`expandirDossies`). Documento juntado não vai para a lixeira sem desentranhar. Reabrir só enquanto tudo está na fase corrente. Novo módulo RBAC `dossies`. |
| 121 | **Dossiê nasce restrito para quem vê restritos e público para quem não vê; pedir restrito sem permissão = 400** | Mesmo padrão do Acervo (#108), sem criar um conjunto invisível para o próprio autor. |
| 122 | **Descrição arquivística multinível pela NOBRADE: árvore acervo (nível 0) → fundo/coleção → seção → série → dossiê → item, com os 28 elementos em 8 áreas; os 7 obrigatórios em colunas e os opcionais em `jsonb`** | Norma do CONARQ para descrição e instrumentos de pesquisa. Hierarquia validada (subseção e subsérie repetem; um único nível 0). Código de referência (1.1) montado pela cadeia ("BR SPPMX SAU.01"), código único entre irmãos. Obrigatórios pendentes aparecem na árvore, sem impedir o rascunho; produtor (2.1) herda do nível superior; condições de acesso (4.1) só obrigatórias nos níveis 0 e 1. |
| 123 | **Datas-limite (1.3) e dimensão e suporte (1.5) sugeridas a partir dos documentos e dossiês vinculados à subárvore; guia do acervo, inventário e catálogo em PDF** | Evita digitação de dados que o sistema já sabe. Documento e dossiê apontam para uma única unidade de descrição; unidade com filhos ou vínculos não pode ser excluída. No catálogo, quem não vê restritos lê "Documento de acesso restrito". Novo módulo RBAC `descricao`. |
| 124 | **"Hoje" no fuso dos órgãos (America/Sao_Paulo): `hojeIso()` no shared, `(now() AT TIME ZONE 'America/Sao_Paulo')::date` no lugar de `current_date` e datas/horas dos PDFs formatadas com fuso explícito; a sessão do Postgres continua em UTC** | Bug encontrado no teste: depois das 21h (horário de Brasília) a abertura de dossiê, prazos de empréstimo, datas de eliminação e o "emitido em" dos PDFs saíam com o dia seguinte/3 h a mais, porque o servidor roda em UTC. Colunas `date` continuam formatadas em UTC (meia-noite UTC = o próprio dia). Mudar o fuso da sessão foi descartado: o zod converte "2024-05-02" em Date UTC e o Postgres gravaria 01/05 (pego pelo e2e de autenticidade). |
