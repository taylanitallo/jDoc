'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, UserRound, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { DropdownMenu } from '@/components/ui/dropdown-menu';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
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
  /** "Minha conta" no menu do avatar. */
  contaHref?: string;
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
    <ShellContext.Provider value={{ recolhida, alternarRecolhida, drawerAberto, setDrawerAberto }}>
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
          <Header titulo={titulo} actions={headerActions} user={user} />
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
  const { recolhida, drawerAberto, setDrawerAberto } = useShell();
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [confirmarSaida, setConfirmarSaida] = useState(false);
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
                {g.items.map(({ href, label, icon: Icon }) => {
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
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                        {!compacta && <span className="truncate">{label}</span>}
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
        <div className={cn('shrink-0 border-t border-white/10 p-3', compacta ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2')}>
          {user && contaHref && (
            <DropdownMenu
              side="top"
              align="start"
              className={cn(!compacta && 'min-w-0 flex-1')}
              items={[
                { label: 'Minha conta', icon: UserRound, onSelect: () => router.push(contaHref) },
                {
                  label: resolvedTheme === 'dark' ? 'Tema claro' : 'Tema escuro',
                  icon: resolvedTheme === 'dark' ? Sun : Moon,
                  onSelect: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
                },
                { label: 'Sair da conta', icon: LogOut, danger: true, onSelect: () => setConfirmarSaida(true) },
              ]}
              trigger={({ aberto, alternar }) => (
                <button
                  type="button"
                  onClick={alternar}
                  aria-haspopup="menu"
                  aria-expanded={aberto}
                  title={compacta ? user.nome : undefined}
                  className={cn(
                    'flex min-w-0 items-center gap-2.5 rounded-[10px] text-left transition hover:bg-white/10',
                    compacta ? 'h-10 w-10 justify-center' : 'w-full p-1',
                  )}
                >
                  <Avatar nome={user.nome} tone="dark" />
                  {!compacta && (
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">{user.nome}</span>
                      <span className="block truncate text-[11px] text-white/45">{user.papel}</span>
                    </span>
                  )}
                </button>
              )}
            />
          )}
          {!compacta && user && !contaHref && (
            <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
              <Avatar nome={user.nome} tone="dark" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">{user.nome}</p>
                <p className="truncate text-[11px] text-white/45">{user.papel}</p>
              </div>
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

function Header({
  titulo,
  actions,
  user,
}: {
  titulo: { title: string; description?: string };
  actions?: ReactNode;
  user: { nome: string; papel: string } | null;
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
        {user && <Avatar nome={user.nome} className="hidden sm:inline-flex" />}
      </div>
    </header>
  );
}
