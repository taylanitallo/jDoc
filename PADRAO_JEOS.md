# PADRÃO JEOS — layout + superadmin (para todo sistema novo ou existente)

> **Como usar:** copie este arquivo para a raiz do projeto como `PADRAO_JEOS.md` e acrescente no `CLAUDE.md` do projeto a linha:
> `Siga SEMPRE o arquivo PADRAO_JEOS.md (layout, superadmin, fuso, idioma). Em conflito, ele vence.`
> Assim toda sessão futura do Claude segue o padrão, não só a primeira.
> Na primeira vez, peça: "Implemente o PADRAO_JEOS.md neste sistema: primeiro o layout, depois o superadmin."

## Regras que valem para o sistema inteiro
- Interface 100% em pt-BR; nenhuma palavra em inglês na tela, logs ou mensagens de erro.
- Fuso padrão `America/Fortaleza` em tudo (ver seção Infraestrutura do superadmin); nunca UTC na exibição ou nas regras de data.
- Hospedagem: front na Vercel, banco no Supabase, API no Railway.
- Rodapé com "JEOS SISTEMAS E ASSESSORIAS LTDA" clicável para https://www.jeossistemas.com.
- **Todo usuário pode mudar as cores/tema do sistema** em "Minha conta › Aparência" (ver "Temas de cor" na Parte 1), no sistema e no superadmin.
- Todo campo de senha tem o botão de olho (Eye/EyeOff, "Mostrar senha"/"Ocultar senha"), implementado uma vez no componente `Input`.
- Antes de concluir qualquer tela: conferir no navegador (desktop 1366px e celular 390px), sem scroll horizontal, tudo nos tokens do padrão.

---

# PARTE 1 — Padrão de layout (seguir exatamente)

## Stack
- Next.js (App Router) + React + TypeScript
- Tailwind CSS v4 (tokens via `@theme` no globals.css, sem tailwind.config)
- Ícones: SOMENTE `lucide-react` (stroke padrão, tamanhos h-4/h-[18px]/h-5). Nunca emoji, nunca outra lib de ícone.
- Fonte: Inter (next/font/google, variável `--font-inter`)
- Utilitário `cn()` = `twMerge(clsx(...))`
- Gráficos: recharts
- Sem biblioteca de componentes (sem shadcn/MUI). Criar componentes próprios em `src/components/ui/`.

## Tokens (colar no globals.css)
```css
@import "tailwindcss";
@theme {
  --color-brand-50:#eef4ff; --color-brand-100:#dbe6fe; --color-brand-200:#bfd3fe;
  --color-brand-300:#93b4fd; --color-brand-400:#608cfa; --color-brand-500:#3b66f6;
  --color-brand-600:#2547eb; --color-brand-700:#1d35d8; --color-brand-800:#1e2eaf;
  --color-brand-900:#1e2d8a; --color-brand-950:#171d54;
  --color-surface:#ffffff; --color-canvas:#f6f8fb;
  --color-ink-50:#f8fafc; --color-ink-100:#f1f5f9; --color-ink-200:#e2e8f0;
  --color-ink-300:#cbd5e1; --color-ink-400:#94a3b8; --color-ink-500:#64748b;
  --color-ink-600:#475569; --color-ink-700:#334155; --color-ink-800:#1e293b; --color-ink-900:#0f172a;
  --color-success-50:#ecfdf5; --color-success-500:#16a34a; --color-success-600:#15803d;
  --color-warning-50:#fffbeb; --color-warning-500:#eab308; --color-warning-600:#ca8a04;
  --color-danger-50:#fef2f2; --color-danger-500:#ef4444; --color-danger-600:#dc2626;
  --color-info-50:#eff6ff; --color-info-500:#3b82f6;
  --shadow-xs: 0 1px 2px 0 rgb(15 23 42 / 0.04);
  --shadow-sm: 0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.04);
  --shadow-md: 0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.04);
  --shadow-xl: 0 24px 48px -12px rgb(15 23 42 / 0.18);
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}
```
- body: bg canvas, texto ink-800, antialiased.
- Dark mode via classe `.dark` no <html>, redefinindo as MESMAS variáveis:
  surface #0b1020, canvas #050816, ink invertida (ink-50 #111827 ... ink-900 #f9fafb),
  e os "-50" viram tons escuros (brand-50 #182238, success-50 #142a1e, warning-50 #2c2512, danger-50 #2c1719).
- Nunca usar cor hex solta nem `bg-white`/`text-gray-*` nas telas: sempre tokens (brand, ink, surface, canvas, success, warning, danger).
- Foco: `:focus-visible { outline: 2px solid brand-500; outline-offset: 2px }`.
- Utilitário `.label-caps`: 11px, bold, uppercase, tracking 0.08em, ink-500.

## Estrutura (AppShell)
- Sidebar fixa à esquerda, fundo `#0f172a`, texto branco. Largura 264px, recolhida 76px (estado salvo no localStorage). No mobile vira drawer (86%, max 300px) com overlay `bg-ink-900/50 backdrop-blur-[2px]`.
- Topo da sidebar = SÍMBOLO: quadrado 36x36 `rounded-[10px] bg-brand-600` com ícone lucide branco no centro + nome do sistema (13px bold) + subtítulo (10px uppercase tracking-wider text-white/45).
- Menu em grupos: título do grupo 10px bold uppercase tracking-[0.12em] text-white/35. Item: `rounded-[10px] px-3 py-2.5 text-sm font-semibold`, ícone 18px. Ativo: `bg-brand-600 text-white shadow-sm`. Inativo: `text-white/65 hover:bg-white/10 hover:text-white`.
- Rodapé da sidebar: avatar com iniciais + nome + papel, botão de tema (Sun/Moon) e "Sair da conta" (ícone LogOut) com diálogo de confirmação.
- Header sticky h-16, `bg-surface/90 backdrop-blur border-b border-ink-200`: botão Menu (mobile), PanelLeftClose/PanelLeftOpen (desktop), título da tela (15px bold) + descrição (xs ink-500), ações à direita, avatar.
- Conteúdo: `px-4 py-6 sm:px-6 lg:px-8`, container `max-w-[1400px] mx-auto`.
- PageHeader: título `text-xl sm:text-2xl font-extrabold tracking-tight text-ink-900`, descrição `text-sm text-ink-500`, link "Voltar" com ChevronLeft opcional, ação à direita.
- App mobile (usuário de campo): header h-14, conteúdo `max-w-2xl`, bottom nav fixa com ícones h-5, respeitando `env(safe-area-inset-bottom)`.

## Menu da conta (avatar do cabeçalho)
- **Fica em cima, nunca embaixo:** o menu da conta abre no avatar do canto superior direito do header (último item das ações, visível também no celular). O nome no rodapé da sidebar só mostra quem está logado e não é clicável. Em qualquer trecho deste padrão, "menu do avatar" significa este menu.
- Botão: círculo com o Avatar de iniciais (tom neutral), `aria-label="Menu da conta"`, `aria-haspopup="menu"`, foco `ring-2 ring-brand-500 ring-offset-2`.
- Painel: `absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-[14px] border border-ink-200 bg-surface shadow-lg`, com fade-in. Fecha com Esc, clique fora, ao escolher um item e ao trocar de rota.
- Topo do painel: `border-b border-ink-100 px-4 py-3.5`, Avatar + nome (`text-sm font-bold text-ink-900`) + papel (`text-xs text-ink-500`).
- Atalhos (`py-1`), cada um `flex items-start gap-3 px-4 py-2.5 hover:bg-ink-50`, ícone 18px ink-500, título `text-sm font-semibold text-ink-800`, descrição `text-xs text-ink-500`:
  - Meu perfil (UserRound): "Seus dados de acesso" → Minha conta;
  - Alterar senha (KeySquare): "Troque sua senha de acesso" → Minha conta `#senha`;
  - Aparência (Palette): "Cor do sistema e modo escuro" → Minha conta `#aparencia`;
  - Aparelhos conectados (MonitorSmartphone): "Veja e encerre sessões" → Minha conta `#aparelhos`.
- Fim do painel (`border-t border-ink-100 py-1`): "Tema escuro"/"Tema claro" (Moon/Sun) e "Sair da conta" (LogOut, `text-danger-600 hover:bg-danger-50`), com o mesmo diálogo de confirmação.
- Os botões de tema e sair continuam também no rodapé da sidebar. No drawer do celular, abaixo deles, um link "Minha conta".

## Troca obrigatória de senha ("Escolha a sua senha")
- **Antes de entrar:** quem acessa com senha provisória vai, logo depois do login, para uma tela própria e sem menu (`/trocar-senha`; no superadmin, `/superadmin/trocar-senha`). Nenhuma tela do sistema abre antes da troca. A troca não acontece dentro de "Minha conta".
- Página: `flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10`, sem foto nem painel lateral.
- Cartão: `w-full max-w-[420px] rounded-[16px] border border-ink-200/70 bg-surface p-6 shadow-md sm:p-8`. Rodapé JEOS abaixo do cartão, com `mt-6`.
- Cabeçalho do cartão (`mb-5 flex items-center gap-3`): ícone KeyRound branco num quadrado `h-10 w-10 rounded-[12px] bg-brand-600` e o título "Escolha a sua senha" (`text-lg font-extrabold tracking-tight text-ink-900`).
- Texto (`mb-5 text-sm text-ink-600`): "Olá, **{nome}**. Você entrou com uma senha provisória. Crie agora a senha que vai usar nos próximos acessos."
- Campos: "Nova senha" e a confirmação, com o botão de olho. Botão `lg`, largura total: "Salvar e entrar".
- Regras: não pede a senha atual (a pessoa acabou de entrar com ela), mas a nova precisa ser diferente da provisória. Até a troca, a API recusa tudo com `403 { code: "trocar_senha" }`, exceto ver a própria conta, trocar a senha e sair. O "entrar como" da equipe não é obrigado a trocar. Depois da troca vai para o sistema; se ainda faltar configurar a verificação em 2 etapas obrigatória, vai para "Minha conta".

## Componentes
- Card: `rounded-[16px] border border-ink-200/70 bg-surface shadow-xs p-5`. CardHeader com `border-b border-ink-100 px-5 py-4`, título `text-sm font-bold`.
- StatCard: chip de ícone 40x40 `rounded-[12px]` em par "fundo -50 + ícone -600" (brand/success/warning/danger), rótulo `.label-caps`, valor grande bold ink-900.
- Button: variants primary (brand-600), secondary, outline, ghost, danger, success. Tamanhos sm h-8 rounded-[8px], md h-10 rounded-[10px], lg h-12 rounded-[12px], icon 40x40. `font-semibold`, loading mostra Loader2 girando e desabilita.
- Badge: `rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset`, com tons em par -50/-600.
- Inputs: `rounded-[10px] border-ink-200 bg-surface text-base sm:text-sm`, foco `border-brand-500 ring-2 ring-brand-500/20`, erro em danger com ícone AlertCircle. Rótulo 13px semibold ink-700, asterisco danger nos obrigatórios. Senha com botão de olho.
- Tabela: header `bg-ink-50/60 border-b border-ink-200`, ícones de ordenação, paginação "Exibindo X–Y de Z".
- Modal: overlay `bg-ink-900/45 backdrop-blur-[2px]`; no mobile abre como bottom sheet (`rounded-t-[20px]`), no desktop centralizado `rounded-[16px] shadow-xl`; header com X.
- Avatar: círculo com iniciais, `ring-1 ring-inset`, tons brand/neutral.
- Toasts para feedback de sucesso e erro; skeleton com shimmer em carregamento.
- Animações: fade-in 0.18s ease-out (overlays), slide-up 0.22s cubic-bezier(0.16,1,0.3,1) (drawers e modais).

## Regras gerais
- Raios: 8 (pequeno), 10 (botão/input/item de menu), 12 (chip), 16 (card/modal), 20 (sheet mobile).
- Hierarquia tipográfica: 10–11px uppercase bold para rótulos; 13–14px para corpo; 15px título do header; 20–24px extrabold título de página.
- `cursor: pointer` em todo botão/link clicável; `not-allowed` + opacity 55% no disabled.
- Mobile-first, sem scroll horizontal; inputs com 16px no celular (evita zoom do iOS).
- Interface em pt-BR.

## Temas de cor (obrigatório em todo sistema)
- **Onde:** "Minha conta › Aparência" para TODO usuário do sistema (e "Minha conta" no superadmin). O cliente (empresa/prefeitura) também tem uma **cor da marca** nas configurações dele (ou no superadmin › Geral), usada como padrão dos seus usuários.
- **Prioridade:** escolha do usuário → cor da marca do cliente → padrão Cosmos (#2547eb).
- **Presets** (cartões com nome, descrição, 3 bolinhas de cor e tags; clicar já mostra a prévia, "Salvar" grava):
  Cosmos #2547eb (padrão) · Floresta & Céu #16a34a · Esperança & Ouro #15803d · Paixão & Solar #b91c1c · Força & Confiança #991b1b · Oceano #0369a1 · Noite #111827.
  Mais "Cor personalizada" (input color + hex validado `^#[0-9a-fA-F]{6}$`) e cores rápidas.
- **Modo:** Claro, Escuro ou "Igual ao sistema" (segmented control), junto do tema.
- **Como aplicar (`src/lib/brand-theme.ts`):**
  - gerar a escala `--color-brand-50…950` a partir da cor escolhida (HSL: mesma matiz, variando luminosidade), versão clara e escura (`html.dark`);
  - gerar também `--sidebar-bg` (mesma matiz, saturação reduzida, luminosidade ~12%; no escuro ~9%) e usar essa variável no fundo da sidebar (padrão `#0f172a`);
  - injetar como `<style id="brand-theme">` no `<head>`; nunca editar classes das telas — tudo continua usando os tokens `brand-*`.
- **Sem piscar:** guardar o CSS gerado no localStorage e aplicá-lo por um script inline no `<head>` antes da pintura; ao carregar o usuário, reaplicar a versão do servidor.
- **Persistência:** `users.ui_theme jsonb` (`{color, mode}`) e `platform.admins.ui_theme`; rota `PUT /auth/preferences` (e `/platform/auth/preferences`); acompanha o usuário em qualquer aparelho. "Usar a cor do cliente" limpa a escolha.
- Telas de login/acesso não usam o tema do usuário (ainda não se sabe quem é).

---

# PARTE 2 — Superadmin


Crie neste sistema a área **/superadmin**: o painel do dono da plataforma (equipe JEOS), com as mesmas opções, funções e layout do padrão abaixo. Siga o "Padrão de layout" que já está neste projeto (tokens, AppShell, componentes). Este documento acrescenta o que é específico do superadmin.

Ambiente: front na **Vercel** (Next.js), banco no **Supabase** (Postgres), backend no **Railway** (API Node/TypeScript). Interface 100% em pt-BR, sem nenhuma palavra em inglês na tela, nos logs ou nas mensagens de erro.

---

## 0. Antes de codar

1. Leia o projeto e descubra como os clientes (tenants) são separados. A separação pode ser por uma coluna `tenant_id` com RLS ou por um schema para cada cliente. Use o nome de cliente do sistema ("prefeitura", "empresa", "unidade"…) em todas as telas. Neste documento, **cliente** é a organização contratante.
2. **Isolamento é obrigatório:**
   - nenhuma tela do superadmin mistura dados de clientes;
   - toda consulta a dados de um cliente filtra pelo cliente informado na rota (`/clientes/:id/...`);
   - o usuário de um cliente nunca acessa o `/superadmin` nem os dados de outro cliente.
3. Reaproveite o que já existe: autenticação dos usuários do sistema, perfis e permissões, envio de e-mail, auditoria. Não duplique.
4. Mostre um plano curto (arquivos, migrações, rotas) e então implemente tudo, sem deixar telas "em construção".

## 1. Infraestrutura (Vercel + Railway + Supabase)

- **Fuso horário padrão: `America/Fortaleza` (UTC−3, sem horário de verão). Não trabalhe em UTC na exibição nem nas regras de data.**
  - Railway: variável `TZ=America/Fortaleza`.
  - Banco: em toda conexão, `set timezone = 'America/Fortaleza'` (opção `connection.timezone` do driver ou `options=-c timezone=America/Fortaleza` na URL). Colunas de data e hora em `timestamptz`; datas puras em `date`.
  - "Hoje", "ontem", "últimas 24 h", vencimentos, agendamentos de backup e prazos de SLA são calculados em Fortaleza, por exemplo `(now() at time zone 'America/Fortaleza')::date` no SQL.
  - Front: formate sempre com `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza' })`. Crie `lib/format.ts` com `fmtDate`, `fmtDateTime`, `fmtRelative` e `todayFortaleza()`.
  - **Nunca** use `new Date().toISOString().slice(0, 10)` para obter "hoje".
- **Supabase:**
  - Tabelas do superadmin no schema **`platform`**.
  - Não exponha `platform` na API REST/GraphQL do Supabase (fora de "Exposed schemas"). Ative RLS sem políticas para `anon`/`authenticated`: só a API (Railway), com a conexão do banco, acessa esse schema.
  - Use a URL do *pooler* (porta 6543, modo transaction) para a API, e a conexão **direta** (porta 5432) para migrações e `pg_dump`/`pg_restore`. Variáveis: `DATABASE_URL` e `DATABASE_URL_DIRECT`.
- **Railway (API):**
  - Variáveis: `ENCRYPTION_KEY` (32 bytes, base64), `SESSION_SECRET`, `SLOW_REQUEST_MS=1000`, `BACKUP_DIR`, `APP_URL` (front) e `S3_*` opcionais.
  - Instale `postgresql-client` (mesma versão major do Supabase) na imagem/Nixpacks para backup e restauração.
  - Migrações versionadas (`migrations/platform/NNN_nome.sql`), aplicadas na subida e registradas numa tabela de controle.
  - Jobs (backup agendado, limpeza) rodam no Railway com trava em banco (`platform.job_locks`), para não rodar em duplicidade.
- **Vercel (front):** de preferência, faça um rewrite `/api/:path*` para a API do Railway (`vercel.json` ou `next.config` rewrites). Assim o cookie de sessão fica no mesmo domínio (`SameSite=Lax`, `Secure`, `HttpOnly`). Se não houver rewrite, o cookie deve ser `SameSite=None; Secure`, com CORS restrito ao domínio do front e `credentials: 'include'`.
- **Segredos** (chaves de API, SMTP, tokens) ficam cifrados em AES-256-GCM com `ENCRYPTION_KEY`. Nunca são devolvidos ao front: a tela mostra só "configurado" e os 4 últimos caracteres.

## 2. Banco: schema `platform`

Adapte a tabela de clientes se o sistema já tiver uma. Não duplique: acrescente as colunas que faltarem.

```sql
create schema if not exists platform;

-- clientes (adapte à tabela existente)
-- status: active | suspended | archived | maintenance (manutenção = indisponível durante restauração)
-- modules jsonb: módulos contratados {"financeiro": true, ...}
-- menu_overrides jsonb: itens de menu desligados para o cliente {"relatorios": false}
-- branding jsonb: {logo_data_url, cor, nome_exibicao}
-- contract jsonb: {numero, vigencia_inicio, vigencia_fim, valor, preposto, fiscal}

create table platform.admins (
  id uuid primary key default gen_random_uuid(),
  name text not null, email text not null unique, password_hash text not null,
  role text not null default 'support' check (role in ('owner','support','implantacao')),
  status text not null default 'active',
  failed_attempts int not null default 0, locked_until timestamptz, last_login_at timestamptz,
  mfa_secret text, mfa_enabled boolean not null default false,
  ui_theme text,
  created_at timestamptz not null default now()
);

create table platform.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references platform.admins(id) on delete cascade,
  token_hash text not null unique, ip text, user_agent text,
  created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null, revoked_at timestamptz,
  reauth_until timestamptz            -- reautenticação para ações críticas (5 min)
);

create table platform.audit_logs (
  id bigserial primary key,
  admin_id uuid, admin_name text,     -- nome guardado no momento (sobrevive à exclusão do admin)
  tenant_id uuid, action text not null, entity text, entity_id text,
  changes jsonb, ip text, user_agent text,
  created_at timestamptz not null default now()
);

create table platform.role_templates (   -- modelos globais dos perfis (só o que difere do padrão do código)
  key text primary key, name text not null, description text, permissions text[] not null,
  updated_by uuid references platform.admins(id) on delete set null, updated_at timestamptz not null default now()
);

create table platform.backups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,                     -- null = backup completo
  kind text not null default 'manual' check (kind in ('manual','agendado','seguranca')),
  status text not null default 'running' check (status in ('running','success','failed')),
  storage text check (storage in ('local','s3')), file_key text, size_bytes bigint, error text,
  created_by uuid, created_by_name text,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create table platform.backup_settings (
  tenant_id uuid primary key, enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily','weekly')),
  hour int not null default 2 check (hour between 0 and 23),   -- hora de Fortaleza
  retention int not null default 7 check (retention between 1 and 90),
  last_run_at timestamptz, updated_at timestamptz not null default now()
);
create table platform.restores (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  backup_id uuid, source text not null check (source in ('backup','upload')), file_name text,
  status text not null default 'running' check (status in ('running','success','failed')), step text,
  safety_backup_id uuid, error text, created_by uuid, created_by_name text,
  created_at timestamptz not null default now(), finished_at timestamptz
);

create table platform.settings (       -- chaves globais padrão (usadas quando o cliente não tem a própria)
  key text primary key, enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb, credentials_encrypted text,
  updated_by uuid, updated_at timestamptz not null default now()
);

create table platform.job_runs (
  id bigserial primary key, tenant_id uuid, job text not null,
  status text not null check (status in ('running','success','failed')),
  attempt int not null default 1, started_at timestamptz not null default now(),
  finished_at timestamptz, stats jsonb, error text
);
create table platform.job_locks (job text primary key, locked_until timestamptz not null, holder text);

create table platform.slow_requests (   -- rota-padrão (sem ids), guardadas por 7 dias
  id bigserial primary key, method text not null, route text not null, status int not null,
  duration_ms int not null, tenant_id uuid, created_at timestamptz not null default now()
);

create sequence platform.ticket_number_seq;
create table platform.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint not null default nextval('platform.ticket_number_seq') unique,
  tenant_id uuid not null, opened_by_user_id uuid, opened_by_name text not null, opened_by_email text,
  channel text not null default 'portal' check (channel in ('portal','email','telefone','whatsapp','presencial')),
  category text not null default 'duvida',
  criticality text not null default 'media' check (criticality in ('critica','alta','media','baixa')),
  title text not null, description text not null,
  status text not null default 'aberto' check (status in ('aberto','em_atendimento','aguardando_cliente','resolvido','fechado','cancelado')),
  assignee_admin_id uuid references platform.admins(id),
  response_due_at timestamptz not null, resolution_due_at timestamptz not null,
  first_response_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
  justification text, contingency text, satisfaction smallint check (satisfaction between 1 and 5),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table platform.ticket_messages (
  id uuid primary key default gen_random_uuid(), ticket_id uuid not null references platform.tickets(id) on delete cascade,
  author_type text not null check (author_type in ('user','admin','system')), author_id uuid, author_name text not null,
  body text not null, internal boolean not null default false, attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table platform.releases (
  id uuid primary key default gen_random_uuid(), version text not null, title text not null, body text not null,
  kind text not null default 'evolutiva' check (kind in ('corretiva','evolutiva','seguranca','manutencao')),
  published_at timestamptz not null default now()
);
```

Índices em `audit_logs(created_at desc)`, `audit_logs(tenant_id, created_at desc)`, `job_runs(started_at desc)`, `slow_requests(created_at desc)`, `backups(tenant_id, created_at desc)`.

Script de criação do primeiro owner (`npm run admin:create -- --email ... --name ...`): pede a senha no terminal e não tem rota pública.

## 3. Autenticação e segurança da equipe

- **Login em 2 etapas** em `POST /platform/auth/login`:
  - Etapa 1: e-mail e senha. Se o admin tem MFA ligado, a resposta é `401 { code: "mfa_required" }`.
  - Etapa 2: o mesmo corpo mais `mfa_code`, um TOTP de 6 dígitos (otplib), com tolerância de ±1 janela.
  - Owner **sem MFA** só consegue usar as rotas de configurar MFA, e o front leva direto para "Minha conta".
- Senha com bcrypt/argon2, mínimo de 10 caracteres.
- **5 erros seguidos bloqueiam a conta por 15 minutos** (`423 Conta bloqueada temporariamente.`).
- Limite de tentativas por IP (ex.: 10 por minuto).
- Mensagem de erro sempre genérica: "E-mail ou senha incorretos."
- **Sessão:**
  - token aleatório; no banco fica só o `sha256`;
  - cookie `HttpOnly` `jeos_admin`;
  - validade de 12 h, deslizante pelo `last_seen_at`;
  - pode ser revogada (minha conta ou equipe).
- **Reautenticação para ações críticas:**
  - Ações críticas: excluir cliente, restaurar backup, "entrar como" usuário, ver ou gerar chave de API, redefinir senha de admin e alterar papel.
  - Sem `reauth_until > now()`, a API responde `403 { code: "reauth_required" }`.
  - O front abre um modal "Confirme sua identidade" com senha e código do autenticador, chama `POST /platform/auth/reauth`, que vale por 5 minutos, e **repete a ação automaticamente**. Faça isso num wrapper único do client HTTP.
- **Papéis:**
  - `owner`: pode tudo.
  - `support`: clientes (leitura e usuários), chamados, logs e jobs.
  - `implantacao`: criar e configurar clientes, módulos, perfis e usuários.
  - Ninguém além do owner mexe em equipe, configurações globais, restauração e exclusão.
  - Use um helper `requireRole(admin, ...papeis)` na API e esconda no menu o que o papel não pode.
- **Auditoria de tudo:**
  - cada escrita grava em `platform.audit_logs` (`admin_name` incluído) o que mudou, em `changes` (antes/depois);
  - login, falha de login, logout, reauth, "entrar como" e download de backup também são registrados.
- **Rota escondida:**
  - nenhum link para `/superadmin` em lugar algum do sistema;
  - `robots: noindex`;
  - título da aba "Acesso restrito".
- **Tela de login mínima:**
  - só um cartão centralizado na vertical e na horizontal, sem rolagem;
  - fundo `canvas`, com, no máximo, manchas de cor suaves;
  - **sem fotos, sem título do sistema, sem texto explicando o que é**;
  - cartão: ícone `Lock` num quadrado `rounded-[12px] bg-brand-600`, título "Área restrita", E-mail, Senha (com botão de olho Eye/EyeOff, "Mostrar senha"/"Ocultar senha") e "Continuar";
  - na etapa 2, "Código" (6 dígitos, `inputMode="numeric"`, `autoComplete="one-time-code"`), "Entrar" e "Voltar";
  - rodapé do cartão: "© {ano} JEOS SISTEMAS E ASSESSORIAS LTDA", com link para https://www.jeossistemas.com.

## 4. Telas do painel

Layout = AppShell do padrão, com sidebar `#0f172a`.
- **Sidebar:**
  - recolhível, com o estado salvo no localStorage;
  - símbolo do sistema no topo, com o subtítulo "SUPERADMIN".
- **Rodapé da sidebar:**
  - avatar com iniciais, nome e papel;
  - **menu do avatar** (Minha conta, Tema, Sair, com confirmação).
  - **esse menu abre no avatar do cabeçalho (canto superior direito), nunca no rodapé da sidebar** (ver "Menu da conta" no padrão de layout); o rodapé só mostra quem está logado, mais os botões de tema e sair.
- **Menu em grupos:**
  - **Visão geral:** Painel.
  - **Clientes:** Clientes, Usuários, Perfis padrão.
  - **Operação:** Backups, Jobs, Logs.
  - **Atendimento:** Chamados, SLA, Releases.
  - **Administração:** Equipe, Configurações.

Toda lista tem busca, filtros, paginação "Exibindo X–Y de Z", estado vazio ilustrado com ícone lucide e skeleton no carregamento. Toda ação mostra toast de sucesso ou erro, e as destrutivas pedem confirmação em modal.

1. **Painel** (`/superadmin`):
   - KPIs em StatCard com faixa colorida no topo: clientes ativos, usuários ativos, sessões nas últimas 24 h, chamados abertos ou atrasados, último backup (ok/falhou), jobs com falha.
   - Bloco "Falhas de login (24 h)", por cliente e por IP.
   - Bloco "Requisições lentas (24 h)": top rotas por tempo médio e máximo; "Ver todas" abre um modal com a lista.
   - Cartões dos clientes: logo, nome, cidade/UF, status, nº de usuários, último acesso e o botão **"Acessar sistema"**, que abre o sistema do cliente em nova aba.
2. **Clientes** (`/superadmin/clientes`):
   - Lista com status em Badge e filtros de status, UF e ambiente.
   - "Novo cliente":
     - nome, identificador (slug) gerado automaticamente;
     - UF e cidade, com seleção UF → cidade pela API do IBGE (`servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios`), com cache;
     - CNPJ, módulos;
     - **admin inicial** (nome e e-mail), que recebe o convite por e-mail.
   - O detalhe (`/superadmin/clientes/[id]`) tem abas:
     - **Geral:**
       - dados, contrato (número e vigência, com alerta de vencimento em 30 dias) e status;
       - suspender ou reativar com motivo;
       - logo enviada como data URL (PNG/JPG/WEBP até 300 KB, com prévia) e cor da marca;
       - excluir, com reauth e digitando o identificador para confirmar.
     - **Módulos e menus:**
       - cartões de módulos com ícone, nome e **descrição do que o módulo faz**, e um Switch para ligar ou desligar;
       - abaixo, os itens de menu de cada módulo (`menu_overrides`) para desligar telas específicas.
     - **Perfis:**
       - perfis do cliente com a **matriz de permissões** (linhas = módulos, colunas = ver, criar, editar, excluir e ações extras);
       - criar perfil com "Começar a partir de" (copia outro perfil), chave gerada do nome;
       - restaurar o padrão de um perfil do sistema.
     - **Usuários:**
       - lista do cliente com perfil, status e último acesso;
       - criar e editar, vínculos/perfis;
       - **redefinir senha** (link por e-mail), **desbloquear**, **encerrar sessões**;
       - **"Entrar como"** (reauth, motivo obrigatório, sessão marcada como impersonação, faixa de aviso no topo do sistema do cliente, tudo auditado).
     - **Chaves de API:**
       - integrações do cliente (ex.: IA, mapas, e-mail, WhatsApp), com chave própria cifrada ou a "padrão da plataforma";
       - botão "Testar conexão".
     - **Acessos:** logins e falhas do cliente (data, usuário, IP, navegador), com filtro por período.
     - **Backup:**
       - backups do cliente;
       - "Fazer backup agora";
       - agendamento (frequência, hora de Fortaleza, retenção);
       - restaurar.
3. **Usuários** (global): busca um usuário em todos os clientes por nome, e-mail ou CPF e mostra em quais clientes ele existe, com atalho para a aba Usuários do cliente.
4. **Perfis padrão:**
   - modelos globais dos perfis (`role_templates`), editados na mesma matriz de permissões;
   - "Voltar ao padrão de fábrica";
   - **"Aplicar a todos os clientes"**, com prévia de quantos perfis mudam.
5. **Backups:**
   - lista geral com cliente, tipo (manual/agendado/segurança), status, tamanho, autor e data;
   - download auditado, excluir, limpar antigos;
   - "Backup completo";
   - o backup roda `pg_dump` em background (status "em andamento" com polling) e o nome do arquivo leva o id, para evitar colisão.
   - **Restaurar** (só owner, com reauth):
     1. faz antes um **backup de segurança** automático;
     2. coloca o cliente em `maintenance`;
     3. restaura num destino novo e só troca no final; se falhar, o original permanece;
     4. mostra o progresso por etapas;
     5. permite enviar um arquivo `.dump` próprio.
6. **Jobs:** execuções (`job_runs`) com status, duração, tentativas e erro; botões "Executar agora" e "Limpar histórico".
7. **Logs:**
   - auditoria da plataforma e dos clientes, com filtros de cliente, admin, ação e período;
   - cada registro **descrito em português claro**, gerado por um `describe(log)`. Exemplo: "Maria alterou o perfil Secretário: incluiu a permissão Excluir em Financeiro".
   - Nunca mostre `campo=true`, chaves técnicas ou JSON cru: traduza os nomes de campos e valores por um dicionário.
   - Detalhe em modal com antes/depois.
8. **Chamados:**
   - fila com número, cliente, título, criticidade (Badge), status, responsável e prazos;
   - **SLA em horas úteis** (seg–sex, 08h–12h e 13h–17h em Fortaleza, pulando feriados):

     | Criticidade | Primeira resposta | Solução |
     |---|---|---|
     | crítica | 2 h | 8 h |
     | alta | 4 h | 8 h |
     | média | 8 h | 16 h |
     | baixa | 8 h | 40 h |

   - Detalhe:
     - conversa, com mensagem interna (só equipe) ou pública e anexos;
     - mudar status, criticidade e responsável;
     - justificativa obrigatória quando estoura o prazo;
     - plano de contingência.
9. **SLA:** relatório por período e cliente: % no prazo (resposta e solução), tempo médio, chamados atrasados, satisfação média; exporta CSV/PDF.
10. **Releases:** notas de versão (versão, título, tipo, texto), publicadas e visíveis aos clientes no sistema ("Novidades").
11. **Equipe** (só owner):
    - admins com papel, status, MFA (sim/não) e último acesso;
    - convidar;
    - alterar papel, desativar, redefinir senha, **resetar MFA** e encerrar sessões, todos com reauth.
12. **Configurações** (só owner):
    - chaves globais padrão (ex.: mapas, IA, SMTP, WhatsApp), usadas quando o cliente não tem a própria;
    - cada uma com ligado/desligado, campos de config, segredo cifrado e "Testar".
13. **Minha conta:**
    - dados;
    - trocar senha;
    - **verificação em 2 etapas** (QR code, confirmar código, desligar com senha e código);
    - **sessões ativas** (dispositivo, IP, último uso, encerrar);
    - **tema**: seletor de presets com prévia ao clicar, salvo em `admins.ui_theme` e aplicado com variáveis CSS no `<html>`, com cache no localStorage para não piscar. Presets:
      - Cosmos (#2547eb), o padrão;
      - Floresta & Céu (#16a34a);
      - Esperança & Ouro (#15803d);
      - Paixão & Solar (#b91c1c);
      - Força & Confiança (#991b1b);
      - Oceano (#0369a1);
      - Noite (#111827).
    - modo claro/escuro.

**Monitoramento de requisições lentas:** um hook `onResponse` da API grava em `platform.slow_requests` quando a duração passa de `SLOW_REQUEST_MS`. Grava a rota-padrão (`/clientes/:id`), nunca a URL com ids ou parâmetros. Um job apaga os registros com mais de 7 dias.

## 5. Rotas da API (prefixo `/platform`)

```
POST   /auth/login | /auth/logout | /auth/reauth | /auth/password
POST   /auth/mfa/setup | /auth/mfa/enable | /auth/mfa/disable
GET    /me                       PUT /auth/preferences (tema)
GET    /auth/sessions            DELETE /auth/sessions/:id
GET    /overview                 GET /slow-requests
GET    /ibge/municipios?uf=
GET    /catalog                  (módulos, menus e permissões do sistema, com descrições)
GET|POST /tenants                GET|PATCH|DELETE /tenants/:id
GET|POST /tenants/:id/roles      PATCH|DELETE /tenants/:id/roles/:roleId   POST /tenants/:id/roles/:roleId/restore
GET|POST /tenants/:id/users      GET|PATCH /tenants/:id/users/:userId
POST   /tenants/:id/users/:userId/reset-password | /unlock | /revoke-sessions
POST   /tenants/:id/impersonate
GET    /tenants/:id/integrations PUT /tenants/:id/integrations/:key   POST /tenants/:id/integrations/:key/test
GET    /tenants/:id/access       GET /tenants/:id/backup-summary
PUT    /tenants/:id/backup-settings
POST   /tenants/:id/restore | /tenants/:id/restore/upload     GET /restores/:rid
GET|POST /backups                GET /backups/:bid/download   DELETE /backups/:bid   DELETE /backups (limpar)
GET    /users?q=                 (busca global)
GET    /role-templates           PUT|DELETE /role-templates/:key   POST /role-templates/:key/apply
GET    /audit                    GET /access
GET    /jobs                     POST /jobs/run   DELETE /jobs
GET    /settings                 PUT /settings/:key
GET    /tickets                  GET|PATCH /tickets/:id   POST /tickets/:id/messages
GET    /sla-report
GET|POST /releases
GET|POST /admins                 PATCH /admins/:aid
POST   /admins/:aid/password | /reset-mfa | /revoke-sessions   GET /admins/:aid/sessions
```

Validação com zod. Erros em pt-BR no formato `{ error: "mensagem", code: "codigo" }`. As rotas do cliente nunca aceitam a sessão de admin, e as rotas `/platform` nunca aceitam a sessão de usuário de cliente.

## 6. Estrutura do front

```
src/app/superadmin/layout.tsx              (metadata: title "Acesso restrito", robots noindex)
src/app/superadmin/login/page.tsx          (cartão centralizado, 2 etapas)
src/app/superadmin/(painel)/layout.tsx     (AppShell do superadmin + guarda de sessão)
src/app/superadmin/(painel)/page.tsx       (Painel)
src/app/superadmin/(painel)/clientes/page.tsx
src/app/superadmin/(painel)/clientes/[id]/{geral,modulos,perfis,usuarios,integracoes,acessos,backup}/page.tsx
src/app/superadmin/(painel)/{usuarios,perfis-padrao,backups,jobs,logs,chamados,sla,releases,equipe,configuracoes,conta}/page.tsx
src/lib/platform-api.ts                    (client com credentials, wrapper de reauth)
src/lib/format.ts                          (datas sempre em America/Fortaleza)
src/lib/brand-theme.ts + components/theme/theme-picker.tsx
src/components/platform/permission-matrix.tsx, reauth-dialog.tsx, kpi.tsx
src/components/brand/jeos.tsx              (JEOS_URL, JeosFooter)
```

Sessão expirada (`401`) leva a `/superadmin/login?next=...`. O guarda do layout busca `/platform/me`.

## 7. Critérios de aceite

- [ ] `npm run typecheck` e `lint` sem erros.
- [ ] Testes de integração da API cobrindo:
  - login com MFA e owner obrigado a configurar MFA;
  - bloqueio após 5 erros;
  - `reauth_required` e repetição da ação;
  - papel `support` barrado em equipe e configurações;
  - isolamento: um usuário de cliente não acessa `/platform`, e o admin não lê o cliente B pela rota do A;
  - backup, restauração e backup de segurança;
  - SLA em horas úteis (abertura sexta 16h30 com prazo de 2 h termina segunda 09h30);
  - descrição de log sem `=true`.
- [ ] Tema: trocar o preset em "Minha conta" muda botões, menus ativos e sidebar na hora; recarregar a página não pisca a cor antiga; o tema acompanha o usuário em outro navegador; sem escolha, vale a cor do cliente.
- [ ] Teste de fuso: um registro criado às 22h00 de Fortaleza aparece com a data **do mesmo dia** na tela e nos filtros "hoje".
- [ ] Playwright:
  - login do `/superadmin` centralizado, sem rolagem em 1366×625 e 390×740, sem fotos e sem texto "Superadmin" na página;
  - nenhuma palavra em inglês nas telas;
  - nenhum link para `/superadmin` no sistema.
- [ ] Deploy:
  - migrações aplicadas no Supabase;
  - API no Railway com `TZ=America/Fortaleza` e `pg_dump` disponível;
  - front na Vercel com rewrite `/api`;
  - um owner criado pelo script.


## 8. Preciso que vc crie tbm um local para o monitoramento de perfomace do nosso sistema

## 9. No superadmin deve ter opção de configurar servidor smtp para envio de emails, a tela de login deve ter opção de esquecer a senha, ai o usuario digita o cpf ou email para que seja mandando um link ou codigo para ele mudar a senha dele.