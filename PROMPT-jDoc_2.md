# PROMPT COMPLETO — jDoc (GED Multi-Tenant para Órgãos Públicos)

> Cole este prompt inteiro na IA do VS Code (Claude Code). Recomendado: iniciar com **Claude Opus 4.8** para arquitetura/scaffold e usar **Sonnet 4.6** nas iterações de features.

---

## 1. PAPEL E CONTEXTO

Você é um engenheiro de software sênior especializado em sistemas para órgãos públicos brasileiros E um especialista sênior em segurança da informação (AppSec/OWASP). Você vai construir o **jDoc — Sistema de Gerenciamento Eletrônico de Documentos (GED)** da empresa **JEOS Sistemas e Assessorias LTDA**, voltado para prefeituras e órgãos públicos, com foco em indexação de documentos financeiros (receitas, despesas, balancetes, extratos) e prestação de contas ao TCE.

O sistema é **multi-tenant com isolamento total por schema no PostgreSQL**. Nada de um tenant pode vazar para outro, em nenhuma circunstância. Segurança é requisito nº 1, acima de qualquer conveniência de desenvolvimento.

Trabalhe em fases (definidas na seção 12). Ao final de cada fase, rode os testes e o checklist de segurança antes de avançar. Não invente features fora do escopo. Se algo estiver ambíguo, escolha a opção mais segura e documente a decisão em `DECISIONS.md`.

---

## 2. STACK E INFRAESTRUTURA (OBRIGATÓRIO)

- **Frontend:** Next.js 15+ (App Router) + TypeScript estrito + TailwindCSS + shadcn/ui + lucide-react + TanStack Query + react-hook-form + zod. Deploy na **Vercel**.
- **Backend:** NestJS (Node 20+, TypeScript estrito) como API REST separada. Deploy no **Railway**.
- **Banco:** PostgreSQL no **Supabase** — **um schema por tenant** (`tenant_<slug>`) + schema `public` apenas para o catálogo global (tenants, superadmins, planos, logs globais). ORM: Prisma ou Drizzle com **queries sempre parametrizadas** e `search_path` fixado por request via conexão dedicada (NUNCA interpolar nome de schema vindo do usuário — validar contra o catálogo com regex `^tenant_[a-z0-9_]{2,30}$`).
- **Cache/Filas/Rate-limit:** **Redis** (Railway ou Upstash) — sessões de refresh token, rate limiting, cache de dashboards, fila BullMQ para: processamento de PDFs, geração de mídia legislativa, backups e importação de etiquetas.
- **Storage de arquivos:** Supabase Storage — **um bucket privado por tenant** (`jdoc-<slug>`), acesso somente por **signed URLs de curta duração (60s)** geradas pelo backend após checagem de permissão. Nunca URL pública.
- **URLs:** padrão `jdoc.jeossistemas.com/<slug-do-orgao>/...` (igual aos outros sistemas JEOS, ex.: `/iraucuba`). Painel master em `jdoc.jeossistemas.com/superadmin`.

Estrutura de repositório (monorepo com pnpm workspaces):

```
jdoc/
├── apps/
│   ├── web/        # Next.js (Vercel)
│   └── api/        # NestJS (Railway)
├── packages/
│   ├── shared/     # tipos, schemas zod compartilhados
│   └── database/   # Prisma/Drizzle, migrations, seeds
├── docker-compose.yml   # dev local: postgres + redis
└── DECISIONS.md
```

---

## 3. IDENTIDADE VISUAL (SEGUIR À RISCA — PADRÃO JEOS)

O jDoc deve seguir a mesma linguagem visual dos sistemas jVeículos e jAgendamento da JEOS:

- **Tela de login:** fundo escuro (#0a0a12 → #12001f) estilo futurista com gradientes **roxo/magenta neon (#a855f7, #d946ef, #7c3aed)**, linhas de circuito/partículas sutis ao fundo, logo "jDoc — Sistema de Gestão Eletrônica de Documentos" à esquerda com tagline (ex.: "Tecnologia inteligente para uma **gestão documental** mais eficiente"), card de login à direita com brasão do órgão (carregado por tenant), campos E-MAIL e SENHA, botão gradiente roxo "Entrar". Rodapé: "© 2026 JEOS SISTEMAS E ASSESSORIAS LTDA • V1.0.0".
- **Área interna:** sidebar escura **azul-marinho (#1e2a4a / #16213e)** com logo/brasão do órgão no topo em faixa verde-bandeira, itens de menu em caixa alta com ícones lucide, item ativo com destaque. Conteúdo em fundo claro (#f8f9fb), cards brancos com borda superior colorida (azul, verde, laranja, roxo — como o dashboard do jVeículos), sparklines nos cards de resumo.
- **Topo:** saudação dinâmica ("BOM DIA / BOA TARDE / BOA NOITE, {NOME}"), seletor de **EXERCÍCIO** (ano) global que filtra todo o sistema, avatar do usuário.
- **Modais:** header em gradiente azul→roxo com título e subtítulo (padrão "Incluir abastecimento" do jVeículos), corpo branco com seções agrupadas, labels claras, placeholders com exemplos.
- **Componentes:** botões primários com gradiente, badges de status coloridos, tabelas com ações (visualizar 👁, editar ✏, excluir 🗑 em vermelho suave), toasts de feedback, skeletons de loading, dark mode opcional (toggle).
- 100% responsivo (desktop-first, funcional em tablet/celular). Todo o texto da UI em **português do Brasil**.

---

## 4. MULTI-TENANCY — ISOLAMENTO 100% (CRÍTICO)

1. **Catálogo global (`public`):** tabelas `tenants` (id, slug, nome, brasão_url, status ativo/inativo, quota_disco_mb, criado_em), `superadmins`, `global_audit_logs`, `backups`.
2. **Schema por tenant:** criado automaticamente ao cadastrar órgão no superadmin (migration programática). Todas as tabelas de negócio vivem no schema do tenant.
3. **Resolução do tenant:** middleware extrai o slug da URL → busca no catálogo (com cache Redis de 60s) → valida `status = ativo` → injeta `tenantId` no contexto do request. Tenant inativo = 403 com página amigável "Órgão suspenso, contate a JEOS".
4. **Regra de ouro:** TODA query de negócio passa por um repositório que exige o contexto do tenant. É proibido acessar schema de tenant sem contexto validado. O JWT do usuário carrega `tenant_id` e o middleware **compara o tenant do token com o tenant da URL** — divergência = 401 imediato + log de segurança.
5. **Storage isolado:** bucket por tenant; o backend valida que o path do arquivo pertence ao tenant do token antes de gerar signed URL (anti-IDOR).
6. **Superadmin NUNCA compartilha sessão/rotas com tenants:** realm de autenticação separado, tabela separada, cookie com path `/superadmin`, JWT com issuer/audience distintos. Um token de tenant jamais acessa `/superadmin` e vice-versa.
7. Testes automatizados de isolamento: usuário do tenant A tentando ler/escrever recurso do tenant B em TODAS as rotas → deve retornar 401/404 sem vazar existência do recurso.

---

## 5. SEGURANÇA (ESPECIALISTA SÊNIOR — NÃO NEGOCIÁVEL)

**Autenticação e sessão**
- Login com e-mail + senha. Hash **Argon2id** (fallback bcrypt cost 12+).
- **JWT de acesso curto (15 min)** + **refresh token rotativo** (7 dias) armazenado em cookie `httpOnly; Secure; SameSite=Strict`, com detecção de reuso (reuso de refresh revogado = revogar família inteira + alertar). Refresh tokens no Redis com hash.
- Bloqueio progressivo por força bruta (5 tentativas → backoff exponencial; chave por conta E por IP no Redis). CAPTCHA opcional após bloqueios.
- **2FA TOTP obrigatório para superadmin**, opcional para admins de tenant.
- Política de senha: mínimo 10 caracteres, checagem contra senhas vazadas comuns, troca forçada no primeiro acesso.
- Logout de todas as sessões, expiração de sessão por inatividade configurável.

**Autorização (RBAC)**
- Papéis por tenant: `admin`, `operador`, `consulta` (somente leitura) + permissões granulares por módulo (receitas, despesas, balancete, extrato, outros, configurações, prestação de contas). Guards no backend em TODAS as rotas (deny by default). O frontend apenas esconde — quem barra é a API.

**API e transporte**
- HTTPS obrigatório, HSTS, helmet, **CSP estrita** (sem `unsafe-inline`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CORS restrito aos domínios da Vercel/JEOS.
- Validação **zod em toda entrada** (body, query, params) — rejeitar campos extras (`strict()`).
- Rate limiting global e por rota sensível (login: 5/min; upload: 20/min; export: 5/min) via Redis.
- IDs públicos como **UUID v4/v7** (nunca sequenciais expostos). Anti-IDOR: toda busca por id inclui filtro do tenant + checagem de permissão.
- Proteções: SQLi (só queries parametrizadas), XSS (escape padrão do React + sanitização de campos ricos), CSRF (SameSite + token em mutações via cookie), path traversal (nomes de arquivo gerados pelo servidor: `uuid.pdf`), SSRF (backend não faz fetch de URLs do usuário), mass assignment (DTOs explícitos), enumeração de usuários (mensagens genéricas no login/recuperação).
- Erros nunca vazam stack trace/SQL em produção; respostas de erro padronizadas.

**Uploads (PDF)**
- Aceitar apenas `application/pdf`, validar **magic bytes** (`%PDF`) no servidor, não confiar no MIME do cliente. Limite 50 MB por arquivo (configurável). Nome original guardado como metadado; arquivo salvo como UUID.
- Verificação de quota do tenant ANTES de aceitar upload (soma de bytes vs `quota_disco_mb`) — ao atingir 90%, alertar admin; a 100%, bloquear upload com mensagem clara.
- Scan opcional (ClamAV em container no Railway ou verificação estrutural do PDF) na fila BullMQ antes de marcar como "disponível".
- Download/visualização somente por signed URL de 60s emitida após checagem de permissão. Visualizador de PDF embutido no sistema.

**Auditoria e logs**
- Tabela `audit_logs` por tenant (append-only): quem, o quê, quando, IP, user-agent, entidade, diff antes/depois em JSON. Ações críticas (login, falha de login, exclusão, download, exportação, alteração de permissão) sempre logadas.
- Logs globais de segurança no `public` (tentativas cross-tenant, bloqueios, ações de superadmin).
- Exclusões de documentos são **soft delete** com lixeira (retenção 30 dias) — órgão público não pode perder documento por engano.

**Backups e LGPD**
- Rotina de backup por tenant (pg_dump do schema + manifest dos arquivos) agendada e sob demanda no superadmin, com histórico e download seguro.
- Criptografia em repouso (Supabase) e em trânsito; segredos só em variáveis de ambiente (nunca no código); `.env.example` documentado.
- Página de termos/privacidade, minimização de dados pessoais, e endpoint de exportação de dados do titular.

**Checklist final:** cobrir OWASP Top 10 2021 item a item em `SECURITY.md`, com como o jDoc mitiga cada um + testes automatizados de segurança (isolamento multi-tenant, authz por papel, upload malicioso, rate limit).

---

## 6. PAINEL SUPERADMIN (`/superadmin`)

Acesso exclusivo JEOS (realm separado, 2FA obrigatório, allowlist de IP opcional via env). Funções:

1. **Órgãos (tenants):** listar, cadastrar (nome, slug, brasão upload, cidade/UF, responsável, e-mail), **ativar/desativar** com um clique (desativar bloqueia login e API do tenant na hora), editar, ver consumo.
2. **Quota de disco:** definir `quota_disco_mb` por órgão (o "tamanho do banco/disco da prefeitura"), com barra de uso (arquivos + estimativa do schema) e alertas em 80/90/100%.
3. **Usuários:** criar/resetar senha/desativar usuários de qualquer tenant (registrado em log global) e gerenciar superadmins.
4. **Backups:** disparar backup por tenant, agendar (diário/semanal), listar histórico com status/tamanho, download seguro, restauração assistida.
5. **Logs:** visualizar logs globais e de qualquer tenant com filtros (período, usuário, ação, IP), destaque para eventos de segurança.
6. **Dashboard master:** total de órgãos, ativos/inativos, armazenamento total, documentos indexados, uploads no mês, gráfico de crescimento.

Nenhuma rota de `/superadmin` pode ser alcançada por token de tenant. Nenhuma rota do superadmin é pública. Testar isso explicitamente.

---

## 7. MÓDULOS DO TENANT — SIDEBAR

Sidebar (padrão visual jVeículos), itens em caixa alta:

1. **HOME/DASHBOARD** — cards: total de documentos no exercício, por módulo (receitas, despesas, balancetes, extratos, outros), uso do disco vs quota, últimos documentos incluídos, atalhos "Ações Rápidas" (Nova Receita, Nova Despesa, Prestação de Contas, Mídia Legislativa), card de exportação estilo "Exportação SIM-TCE" do jVeículos.
2. **RECEITAS** — orçamentárias e extraorçamentárias (filtro por tipo).
3. **DESPESAS** — orçamentárias e extraorçamentárias (filtro por tipo).
4. **BALANCETE ORÇAMENTÁRIO**
5. **EXTRATO DE CONTAS**
6. **OUTROS ARQUIVOS** — usa os "Tipos de Documento" cadastrados em Configurações.
7. **PRESTAÇÃO DE CONTAS**
8. **MÍDIA LEGISLATIVA**
9. **CONFIGURAÇÕES**

### 7.1 Padrão de TODAS as abas de documentos (2–6)

Cada aba tem, no topo: **campo de BUSCA** (texto livre + filtros avançados: período, unidade orçamentária, credor, empenho, etiqueta, tipo), botão **INCLUIR** (abre modal) e botão **IMPORTAR ETIQUETAS** com seleção do formato: **SS, ASPEC ou JBS** (upload de arquivo TXT/CSV/planilha do sistema contábil; parser dedicado por formato em `packages/shared/parsers/`, com **preview dos registros interpretados + validação + relatório de erros linha a linha ANTES de confirmar a importação**; processamento na fila BullMQ; tudo auditado). Tabela paginada (server-side) com ordenação, badges de status, ações ver/editar/excluir(lixeira), e visualização do PDF em modal/aba interna.

### 7.2 Modais de inclusão

Todos com header gradiente e upload de PDF com drag-and-drop + barra de progresso.

- **DESPESA:** Doc. Caixa*, Empenho*, Credor*, Tipo* (Orçamentária | Extraorçamentária), Histórico (opcional), Órgão/Unidade Orçamentária* (select das secretarias cadastradas), Data do Documento*, Valor, Elemento de Despesa (select), Dotação (select), upload PDF*.
- **RECEITA:** Tipo* (Orçamentária | Extraorçamentária), Descrição/Histórico, Órgão*, Data*, Valor, Conta, upload PDF*.
- **BALANCETE:** Exercício*, Competência (mês)*, Órgão*, upload PDF*.
- **EXTRATO:** Banco/Agência/Conta*, Competência*, Órgão*, upload PDF*.
- **OUTROS:** Tipo de Documento* (cadastrável), Descrição*, Órgão*, Data*, upload PDF*.

Campos com * obrigatórios, validação zod espelhada no front e no back.

### 7.3 PRESTAÇÃO DE CONTAS

Tela para gerar o pacote de prestação: selecionar **período** (data início/fim), **tipo de data de envio** (radio: **Por Produção** — data de inclusão no sistema — ou **Por Data do Documento**), **ordenação** (Ordem Alfabética | Por Data), e **Relatório Resumido** agrupado **Por Categoria ou Por Subcategoria**. Preview em tela + geração de PDF do relatório (capa com brasão do órgão, período, totais por grupo, listagem dos documentos) + opção de baixar ZIP com os PDFs organizados em pastas por categoria. Geração assíncrona (fila) com notificação quando pronto e histórico de gerações.

### 7.4 MÍDIA LEGISLATIVA

Formulário: **Exercício** (ano), **Competências do mês** (multi-select de meses), **Mídias desejadas** (multi-select com chips: Balancete, Extrato, Receita, Despesa, Outros, etc.). Gera pacote ZIP com estrutura de pastas `Exercicio/Competencia/TipoDeMidia/arquivos.pdf` + índice em PDF, via fila, com histórico e download seguro.

---

## 8. CONFIGURAÇÕES (com guias na TOPBAR)

Guias no topo da página de Configurações:

1. **Unidades Orçamentárias (Secretarias):** CRUD. Ao entrar numa unidade, sub-abas para cadastrar: **Projetos/Atividades**, **Dotações Orçamentárias**, **Elementos de Despesa** e **Ordenadores de Despesa** (nome, CPF mascarado, cargo, período de vigência). Tudo vinculado à unidade.
2. **Tipos de Documento:** CRUD dos tipos usados em "Outros Arquivos" (nome, descrição, cor do badge) — permite ao usuário organizar melhor os documentos.
3. **Usuários e Permissões:** CRUD de usuários do tenant (nome, e-mail, papel, permissões por módulo com checkboxes, unidades às quais tem acesso), reset de senha, ativar/desativar, ver último acesso.
4. **Layout:** personalização do tenant — brasão/logo, nome exibido, cor de destaque, texto do rodapé, imagem/fundo da tela de login. Preview ao vivo.

---

## 9. MODELO DE DADOS (por schema de tenant — mínimo)

`users`, `roles/permissions`, `budget_units` (secretarias), `projects_activities`, `allocations` (dotações), `expense_elements`, `expense_authorizers` (ordenadores), `document_types`, `documents` (id uuid, module enum[receita|despesa|balancete|extrato|outro], subtype enum[orcamentaria|extraorcamentaria|null], doc_caixa, empenho, credor, historico, budget_unit_id, document_date, value, competencia, exercicio, file_key, file_size, file_hash sha-256, status, created_by, deleted_at), `labels_imports` (formato SS/ASPEC/JBS, arquivo, status, relatório de erros), `report_jobs` (prestação de contas / mídia legislativa), `audit_logs`. Índices por exercício, competência, módulo, unidade, credor e busca (`pg_trgm` para busca textual). Campo `exercicio` presente em tudo e filtrado pelo seletor global do topo.

---

## 10. QUALIDADE

- TypeScript `strict`, ESLint + Prettier, commits convencionais.
- Testes: unitários (parsers de etiqueta, validações), integração (auth, RBAC, isolamento multi-tenant, quota, upload) e e2e mínimos (login, incluir despesa, prestação de contas). Cobertura mínima 70% no backend.
- Seeds de desenvolvimento: 1 tenant demo + usuários de cada papel + dados fake.
- `README.md` com setup local (docker-compose), variáveis de ambiente e passo a passo de deploy (Vercel + Railway + Supabase + Redis). `SECURITY.md` com o checklist OWASP preenchido.

---

## 11. VARIÁVEIS DE AMBIENTE (documentar em .env.example)

`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (só no backend, nunca no front), `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `SUPERADMIN_ALLOWED_IPS` (opcional), `MAX_UPLOAD_MB`, `FRONTEND_URL`, `NODE_ENV`.

---

## 12. FASES DE ENTREGA (executar nesta ordem)

1. **Fase 1 — Fundação:** monorepo, docker-compose dev, catálogo global, criação automática de schema por tenant, auth completa (tenant + superadmin separados), RBAC, middleware de tenant, auditoria base, layout base (login futurista + shell com sidebar/topbar + seletor de exercício).
2. **Fase 2 — Superadmin:** CRUD de órgãos, ativar/desativar, quotas, usuários, logs, dashboard master.
3. **Fase 3 — Documentos:** módulos Receitas, Despesas, Balancete, Extrato, Outros com busca, modais de inclusão, upload seguro para o Storage, visualizador de PDF, lixeira.
4. **Fase 4 — Etiquetas:** parsers SS/ASPEC/JBS com preview e importação em fila.
5. **Fase 5 — Relatórios:** Prestação de Contas + Mídia Legislativa (geração assíncrona, ZIP, histórico).
6. **Fase 6 — Configurações:** unidades e cadastros filhos, tipos de documento, usuários/permissões, layout do tenant.
7. **Fase 7 — Hardening:** backups, rate limits finais, testes de isolamento e segurança, SECURITY.md, polimento de UX, dark mode.

Comece agora pela Fase 1. Antes de codar, apresente um plano curto da fase e o diagrama de pastas; depois implemente.
