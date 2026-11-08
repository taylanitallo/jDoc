'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import {
  KeySquare,
  LogOut,
  Menu,
  MonitorSmartphone,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Selo de contagem (ex.: novidades nao lidas). */
  badge?: number;
}
export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

const CHAVE_RECOLHIDA = 'jdoc-sidebar-recolhida';

const ShellContext = createContext<{
  recolhida: boolean;
  alternarRecolhida: () => void;
  drawerAberto: boolean;
  setDrawerAberto: (v: boolean) => void;
  confirmarSaida: boolean;
  setConfirmarSaida: (v: boolean) => void;
} | null>(null);

function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell fora do AppShell');
  return ctx;
}

/**
 * Casca do produto: sidebar fixa (264px / 76px recolhida, estado no
 * localStorage; drawer no celular), header sticky com titulo da tela e
 * conteudo em container de 1400px.
 */
export function AppShell({
  appName,
  subtitle,
  icon,
  groups,
  user,
  onLogout,
  titulo,
  headerActions,
  banner,
  switcher,
  corAtiva = 'bg-brand-600',
  contaHref,
  aparelhosConectados = false,
  children,
}: {
  appName: string;
  subtitle: string;
  icon: LucideIcon;
  groups: NavGroup[];
  user: { nome: string; papel: string } | null;
  onLogout: () => Promise<void> | void;
  titulo: { title: string; description?: string };
  headerActions?: ReactNode;
  banner?: ReactNode;
  /** Seletor abaixo do simbolo (ex.: modulo ativo). Recebe se a sidebar esta compacta. */
  switcher?: (compacta: boolean) => ReactNode;
  /** Fundo do item ativo do menu (cor do modulo em uso). */
  corAtiva?: string;
  /** Tela "Minha conta": destino dos atalhos do menu do avatar no cabecalho. */
  contaHref?: string;
  /** Mostra "Aparelhos conectados" no menu do avatar (a tela precisa ter a secao #aparelhos). */
  aparelhosConectados?: boolean;
  children: ReactNode;
}) {
  // A casca so monta no cliente (depois do bootstrap da sessao), entao da para
  // ler o localStorage ja no primeiro render: a sidebar nao pisca expandida.
  const [recolhida, setRecolhida] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_RECOLHIDA) === '1';
    } catch {
      return false; // localStorage indisponivel (modo privado): segue expandida
    }
  });
  const [drawerAberto, setDrawerAberto] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const pathname = usePathname();

  // Troca de rota fecha o drawer do celular.
  useEffect(() => setDrawerAberto(false), [pathname]);

  const alternarRecolhida = () =>
    setRecolhida((r) => {
      try {
        localStorage.setItem(CHAVE_RECOLHIDA, r ? '0' : '1');
      } catch {
        // ignora
      }
      return !r;
    });

  return (
    <ShellContext.Provider value={{ recolhida, alternarRecolhida, drawerAberto, setDrawerAberto, confirmarSaida, setConfirmarSaida }}>
      <div className="min-h-screen bg-canvas">
        {/* Overlay do drawer (celular) */}
        {drawerAberto && (
          <div
            className="animate-fade-in fixed inset-0 z-40 bg-ink-900/50 backdrop-blur-[2px] md:hidden"
            onClick={() => setDrawerAberto(false)}
            aria-hidden
          />
        )}
        <Sidebar appName={appName} subtitle={subtitle} icon={icon} groups={groups} user={user} onLogout={onLogout} switcher={switcher} corAtiva={corAtiva} contaHref={contaHref} />
        <div
          data-print-reset
          className={cn('flex min-h-screen flex-col transition-[padding] duration-200', recolhida ? 'md:pl-[76px]' : 'md:pl-[264px]')}
        >
          <Header titulo={titulo} actions={headerActions} user={user} contaHref={contaHref} aparelhosConectados={aparelhosConectados} />
          {banner}
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

function Sidebar({
  appName,
  subtitle,
  icon: Icone,
  groups,
  user,
  onLogout,
  switcher,
  corAtiva,
  contaHref,
}: {
  appName: string;
  subtitle: string;
  icon: LucideIcon;
  groups: NavGroup[];
  user: { nome: string; papel: string } | null;
  onLogout: () => Promise<void> | void;
  switcher?: (compacta: boolean) => ReactNode;
  corAtiva: string;
  contaHref?: string;
}) {
  const { recolhida, drawerAberto, setDrawerAberto, confirmarSaida, setConfirmarSaida } = useShell();
  const pathname = usePathname();
  const [saindo, setSaindo] = useState(false);
  // No celular (drawer) sempre expandida.
  const compacta = recolhida && !drawerAberto;

  return (
    <>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-[var(--sidebar-bg,#0f172a)] text-white transition-[transform,width] duration-200',
          'w-[86%] max-w-[300px] md:max-w-none',
          drawerAberto ? 'translate-x-0 shadow-xl' : '-translate-x-full md:translate-x-0',
          compacta ? 'md:w-[76px]' : 'md:w-[264px]',
        )}
        aria-label="Menu principal"
      >
        {/* Simbolo */}
        <div className={cn('flex h-16 shrink-0 items-center gap-3 border-b border-white/10', compacta ? 'justify-center px-2' : 'px-5')}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-600 shadow-sm">
            <Icone className="h-5 w-5 text-white" aria-hidden />
          </span>
          {!compacta && (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold leading-tight">{appName}</p>
              <p className="truncate text-[10px] uppercase tracking-wider text-white/45">{subtitle}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setDrawerAberto(false)}
            aria-label="Fechar menu"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-[8px] text-white/65 hover:bg-white/10 hover:text-white md:hidden"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>

        {switcher && <div className={cn('shrink-0 border-b border-white/10 py-3', compacta ? 'px-2' : 'px-3')}>{switcher(compacta)}</div>}

        {/* Navegacao */}
        <nav
          className="no-scrollbar flex-1 overflow-y-auto px-3 py-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]"
        >
          {groups.map((g, i) => (
            <div key={g.title ?? `g${i}`} className={cn(i > 0 && 'mt-4')}>
              {g.title &&
                (compacta ? (
                  <div className="mx-2 mb-2 border-t border-white/10" aria-hidden />
                ) : (
                  <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">{g.title}</p>
                ))}
              <ul className="space-y-1">
                {g.items.map(({ href, label, icon: Icon, badge }) => {
                  const ativo = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        title={compacta ? label : undefined}
                        aria-current={ativo ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors',
                          compacta && 'justify-center px-0',
                          ativo ? cn(corAtiva, 'text-white shadow-sm') : 'text-white/65 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <span className="relative">
                          <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                          {!!badge && compacta && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger-500" aria-hidden />}
                        </span>
                        {!compacta && <span className="truncate">{label}</span>}
                        {!!badge && !compacta && (
                          <span className="ml-auto rounded-full bg-danger-500 px-1.5 text-[11px] font-bold tabular-nums text-white" aria-label={`${badge} não lida(s)`}>
                            {badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Rodape: usuario, tema e sair */}
        {/* Uma linha so (avatar, nome, tema, sair): nao rouba altura do menu em telas baixas. */}
        <div className="shrink-0 border-t border-white/10 p-3">
          <div className={cn(compacta ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2')}>
            {/* So mostra quem esta logado; as acoes ficam no menu do avatar do cabecalho. */}
            {user && (
              <div className={cn('flex items-center gap-2.5', compacta ? 'h-10 w-10 justify-center' : 'min-w-0 flex-1 p-1')}>
                <Avatar nome={user.nome} tone="dark" />
                {!compacta && (
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{user.nome}</p>
                    <p className="truncate text-[11px] text-white/45">{user.papel}</p>
                  </div>
                )}
              </div>
            )}
            <BotaoTema compacta={compacta} />
            <button
              type="button"
              onClick={() => setConfirmarSaida(true)}
              title="Sair da conta"
              aria-label="Sair da conta"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-white/65 transition hover:bg-danger-500/20 hover:text-white"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>
          {drawerAberto && contaHref && (
            <Link
              href={contaHref}
              onClick={() => setDrawerAberto(false)}
              className="mt-2 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-semibold text-white/65 hover:bg-white/10 md:hidden"
            >
              <UserRound className="h-4 w-4" aria-hidden /> Minha conta
            </Link>
          )}
        </div>
      </aside>

      <Modal
        open={confirmarSaida}
        onClose={() => setConfirmarSaida(false)}
        title="Sair da conta?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmarSaida(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={saindo}
              leftIcon={<LogOut aria-hidden />}
              onClick={async () => {
                setSaindo(true);
                try {
                  await onLogout();
                } finally {
                  setSaindo(false);
                }
              }}
            >
              Sair
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">Sua sessão será encerrada neste navegador.</p>
      </Modal>
    </>
  );
}

function BotaoTema({ compacta }: { compacta: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const escuro = montado && resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(escuro ? 'light' : 'dark')}
      aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
      title={escuro ? 'Tema claro' : 'Tema escuro'}
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-white/65 transition hover:bg-white/10 hover:text-white',
      )}
    >
      {escuro ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
      <span className="sr-only">{compacta ? 'Tema' : ''}</span>
    </button>
  );
}

/** Menu do avatar no cabecalho (padrao JEOS): atalhos da "Minha conta", tema e sair. */
function MenuConta({
  user,
  contaHref,
  aparelhosConectados,
}: {
  user: { nome: string; papel: string };
  contaHref: string;
  aparelhosConectados: boolean;
}) {
  const { setConfirmarSaida } = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const escuro = resolvedTheme === 'dark';

  useEffect(() => setAberto(false), [pathname]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const atalhos: { label: string; descricao: string; icon: LucideIcon; href: string }[] = [
    { label: 'Meu perfil', descricao: 'Seus dados de acesso', icon: UserRound, href: contaHref },
    { label: 'Alterar senha', descricao: 'Troque sua senha de acesso', icon: KeySquare, href: `${contaHref}#senha` },
    { label: 'Aparência', descricao: 'Cor do sistema e modo escuro', icon: Palette, href: `${contaHref}#aparencia` },
    ...(aparelhosConectados
      ? [{ label: 'Aparelhos conectados', descricao: 'Veja e encerre sessões', icon: MonitorSmartphone, href: `${contaHref}#aparelhos` }]
      : []),
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label="Menu da conta"
        className="flex rounded-full outline-none ring-offset-2 ring-offset-surface focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Avatar nome={user.nome} tone="neutral" />
      </button>
      {aberto && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-[14px] border border-ink-200 bg-surface text-ink-800 shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3.5">
            <Avatar nome={user.nome} tone="neutral" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900">{user.nome}</p>
              <p className="truncate text-xs text-ink-500">{user.papel}</p>
            </div>
          </div>
          <div className="py-1">
            {atalhos.map(({ label, descricao, icon: Icone, href }) => (
              <Link key={href} href={href} role="menuitem" onClick={() => setAberto(false)} className="flex items-start gap-3 px-4 py-2.5 hover:bg-ink-50">
                <Icone className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-500" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-800">{label}</span>
                  <span className="block text-xs text-ink-500">{descricao}</span>
                </span>
              </Link>
            ))}
          </div>
          <div className="border-t border-ink-100 py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => setTheme(escuro ? 'light' : 'dark')}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-semibold text-ink-800 hover:bg-ink-50"
            >
              {escuro ? <Sun className="h-[18px] w-[18px] text-ink-500" aria-hidden /> : <Moon className="h-[18px] w-[18px] text-ink-500" aria-hidden />}
              {escuro ? 'Tema claro' : 'Tema escuro'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAberto(false);
                setConfirmarSaida(true);
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-semibold text-danger-600 hover:bg-danger-50"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden /> Sair da conta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({
  titulo,
  actions,
  user,
  contaHref,
  aparelhosConectados,
}: {
  titulo: { title: string; description?: string };
  actions?: ReactNode;
  user: { nome: string; papel: string } | null;
  contaHref?: string;
  aparelhosConectados: boolean;
}) {
  const { recolhida, alternarRecolhida, setDrawerAberto } = useShell();
  return (
    <header
      data-print-hide
      className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-200 bg-surface/90 px-4 backdrop-blur sm:px-6 lg:px-8"
    >
      <button
        type="button"
        onClick={() => setDrawerAberto(true)}
        aria-label="Abrir menu"
        className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-ink-600 hover:bg-ink-100 hover:text-ink-900 md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={alternarRecolhida}
        aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
        title={recolhida ? 'Expandir menu' : 'Recolher menu'}
        className="-ml-2 hidden h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-ink-500 hover:bg-ink-100 hover:text-ink-900 md:flex"
      >
        {recolhida ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-ink-900">{titulo.title}</p>
        {titulo.description && <p className="hidden truncate text-xs text-ink-500 sm:block">{titulo.description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {user && contaHref && <MenuConta user={user} contaHref={contaHref} aparelhosConectados={aparelhosConectados} />}
      </div>
    </header>
  );
}
