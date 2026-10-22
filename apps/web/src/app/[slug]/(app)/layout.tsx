'use client';

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  Archive,
  BarChart3,
  FileCheck,
  FileStack,
  Film,
  FolderOpen,
  FolderSync,
  Home,
  Landmark,
  Library,
  MessagesSquare,
  Scale,
  ScanSearch,
  Settings,
  ShieldCheck,
  ShieldAlert,
  EyeOff,
  LogOut,
  TrendingDown,
  TrendingUp,
  Warehouse,
  BookOpenText,
  FolderKanban,
} from 'lucide-react';
import type { Sistema, UsuarioAtual } from '@jdoc/shared';
import { AppShell, type NavGroup } from '@/components/shell/app-shell';
import { ContaMenu, ExercicioProvider, ExercicioSelect } from '@/components/topbar';
import { BrandingProvider, useBranding } from '@/components/branding';
import { DesktopUpdateBanner } from '@/components/desktop-update-banner';
import { AssistenteWidget, AylaVisibilityProvider } from '@/components/assistente-widget';
import { api, encerrarImpersonacao, setAccessToken, setLastTenantSlug } from '@/lib/api';
import { EmptyState } from '@/components/empty-state';
import { TelaSessao, useSessao } from '@/components/shell/sessao';
import { isDesktopApp } from '@/lib/desktop-bridge';
import { cn } from '@/lib/cn';
import { MODULO_VISUAL, ModuloAtivoProvider, moduloDaRota, useModuloAtivo } from '@/components/modulo-ativo';
import { EscolhaModulo } from '@/components/escolha-modulo';
import { useTemaUsuario } from '@/components/theme/use-tema-usuario';

const PAPEL: Record<UsuarioAtual['role'], string> = { admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' };

/** Titulo e descricao do header por rota (segmento apos /<slug>/). */
const TITULOS: Record<string, { title: string; description: string }> = {
  dashboard: { title: 'Início', description: 'Visão geral do órgão no exercício' },
  receitas: { title: 'Receitas', description: 'Receitas orçamentárias e extraorçamentárias' },
  despesas: { title: 'Despesas', description: 'Empenhos, liquidações e pagamentos' },
  balancete: { title: 'Balancete', description: 'Balancetes orçamentários mensais' },
  extrato: { title: 'Extrato de contas', description: 'Extratos bancários por competência' },
  outros: { title: 'Outros arquivos', description: 'Documentos diversos organizados por tipo' },
  'prestacao-contas': { title: 'Prestação de contas', description: 'Pacotes para o Tribunal de Contas' },
  'midia-legislativa': { title: 'Mídia legislativa', description: 'Pacotes mensais para a Câmara Municipal' },
  'pasta-monitorada': { title: 'Pasta monitorada', description: 'Envio automático pelo jDoc Desktop' },
  acervo: { title: 'Acervo', description: 'Documentos do Arquivo Municipal' },
  dossies: { title: 'Dossiês e processos', description: 'Conjuntos documentais com guarda a partir do encerramento' },
  descricao: { title: 'Descrição arquivística', description: 'NOBRADE: quadro de arranjo e instrumentos de pesquisa' },
  normas: { title: 'Legislação', description: 'Texto compilado de leis, decretos e portarias' },
  'arquivo-fisico': { title: 'Arquivo físico', description: 'Caixas, localização dos originais e empréstimos' },
  temporalidade: { title: 'Temporalidade', description: 'Prazos de guarda, transferências e eliminação' },
  integridade: { title: 'Integridade', description: 'Conferência periódica dos arquivos digitais' },
  relatorios: { title: 'Relatórios', description: 'Inventário, quantitativos e localização dos originais' },
  atendimento: { title: 'Atendimento', description: 'Pedidos de consulta e acesso ao acervo (LAI)' },
  sigilo: { title: 'Sigilo', description: 'Informações classificadas pela LAI' },
  busca: { title: 'Busca no conteúdo', description: 'Procure dentro do texto dos PDFs' },
  configuracoes: { title: 'Configurações', description: 'Cadastros, usuários e personalização' },
  conta: { title: 'Minha conta', description: 'Seus dados, senha e aparência' },
};

export default function TenantLayout({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const { slug } = useParams<{ slug: string }>();

  // Cache o slug do tenant no cliente HTTP (necessario para refresh single-flight).
  useEffect(() => {
    if (slug) setLastTenantSlug(slug);
  }, [slug]);

  // Bootstrap de sessao: refresh via cookie httpOnly (com timeout e "Tentar novamente").
  const { estado, tentarDeNovo } = useSessao(slug, `/${slug}/login`);
  if (estado !== 'pronta') return <TelaSessao estado={estado} onTentar={tentarDeNovo} />;

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider slug={slug}>
        <ExercicioProvider>
          <AylaVisibilityProvider>
            <ModuloAtivoProvider slug={slug}>
              <Casca slug={slug}>{children}</Casca>
            </ModuloAtivoProvider>
            <AssistenteWidget />
          </AylaVisibilityProvider>
        </ExercicioProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}

function Casca({ slug, children }: { slug: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { nomeExibido, modulos } = useBranding();
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktopApp()), []);

  const { data: usuario } = useQuery({
    queryKey: ['auth', 'me', slug],
    queryFn: () => api<UsuarioAtual>(`/t/${slug}/auth/me`),
    staleTime: 5 * 60_000,
  });

  // Tema de cor do usuario (ou a cor do orgao), reaplicado com a versao do servidor.
  useTemaUsuario(slug, usuario?.uiTheme, usuario?.corOrgao, !!usuario);

  const base = `/${slug}`;
  const { ativo, ambos, trocar } = useModuloAtivo();
  const temFinanceiro = ativo === 'financeiro' && modulos.includes('financeiro');
  const temArquivo = ativo === 'arquivo' && modulos.includes('arquivo');
  const groups: NavGroup[] = [
    { title: null, items: [{ href: `${base}/dashboard`, label: 'Início', icon: Home }] },
    ...(temFinanceiro
      ? [
          {
            title: 'Financeiro / Contábil',
            items: [
              { href: `${base}/receitas`, label: 'Receitas', icon: TrendingUp },
              { href: `${base}/despesas`, label: 'Despesas', icon: TrendingDown },
              { href: `${base}/balancete`, label: 'Balancete', icon: Scale },
              { href: `${base}/extrato`, label: 'Extrato de contas', icon: Landmark },
              { href: `${base}/outros`, label: 'Outros arquivos', icon: FolderOpen },
              { href: `${base}/prestacao-contas`, label: 'Prestação de contas', icon: FileCheck },
              { href: `${base}/midia-legislativa`, label: 'Mídia legislativa', icon: Film },
              // Pasta Monitorada so existe dentro do jDoc Desktop.
              ...(desktop ? [{ href: `${base}/pasta-monitorada`, label: 'Pasta monitorada', icon: FolderSync }] : []),
            ],
          },
        ]
      : []),
    ...(temArquivo
      ? [
          {
            title: 'Arquivo Municipal',
            items: [
              { href: `${base}/acervo`, label: 'Acervo', icon: Library },
              { href: `${base}/dossies`, label: 'Dossiês e processos', icon: FolderKanban },
              { href: `${base}/descricao`, label: 'Descrição (NOBRADE)', icon: BookOpenText },
              { href: `${base}/normas`, label: 'Legislação', icon: Scale },
              { href: `${base}/arquivo-fisico`, label: 'Arquivo físico', icon: Warehouse },
              { href: `${base}/atendimento`, label: 'Atendimento', icon: MessagesSquare },
              { href: `${base}/sigilo`, label: 'Sigilo', icon: ShieldAlert },
              { href: `${base}/temporalidade`, label: 'Temporalidade', icon: Archive },
              { href: `${base}/integridade`, label: 'Integridade', icon: ShieldCheck },
              { href: `${base}/relatorios`, label: 'Relatórios', icon: BarChart3 },
            ],
          },
        ]
      : []),
    {
      title: 'Geral',
      items: [
        { href: `${base}/busca`, label: 'Busca no conteúdo', icon: ScanSearch },
        { href: `${base}/configuracoes`, label: 'Configurações', icon: Settings },
      ],
    },
  ];

  // Telas desligadas pelo superadmin somem do menu e mostram aviso se abertas pelo endereco.
  const desligados = new Set(usuario?.menusDesligados ?? []);
  const groupsVisiveis = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !desligados.has(i.href.slice(base.length + 1))) }))
    .filter((g) => g.items.length > 0);

  const segmento = pathname.slice(base.length + 1).split('/')[0] ?? '';
  const titulo = TITULOS[segmento] ?? { title: 'jDoc' };

  // Senha provisoria: nada alem de Minha conta ate trocar.
  const trocaObrigatoria = !!usuario?.mustChangePassword && segmento !== 'conta';
  useEffect(() => {
    if (trocaObrigatoria) router.replace(`${base}/conta?trocar=1`);
  }, [trocaObrigatoria, router, base]);

  const sair = async () => {
    // "Entrar como": so encerra esta aba (o logout revogaria o cookie de outra sessao).
    if (usuario?.impersonacao) {
      encerrarImpersonacao(slug);
      window.close();
      router.replace(`/${slug}/login`);
      return;
    }
    try {
      await api(`/t/${slug}/auth/logout`, { method: 'POST' });
    } finally {
      setAccessToken(null);
      router.replace(`/${slug}/login`);
    }
  };

  // Logo apos o login: os dois quadrados para escolher o modulo (sem menu lateral).
  if (segmento === 'modulos') return <EscolhaModulo slug={slug} nome={usuario?.nome ?? null} onSair={() => void sair()} />;


  return (
    <AppShell
      appName="jDoc"
      subtitle={nomeExibido ?? usuario?.orgao ?? 'Gestão de documentos'}
      icon={FileStack}
      groups={groupsVisiveis}
      user={usuario ? { nome: usuario.nome, papel: PAPEL[usuario.role] } : null}
      onLogout={sair}
      contaHref={`${base}/conta`}
      corAtiva={ativo ? MODULO_VISUAL[ativo].solido : undefined}
      titulo={titulo}
      headerActions={
        <>
          {/* O exercicio e do Financeiro; o Arquivo lida com acervo historico (filtra por ano nas proprias telas). */}
          {ativo !== 'arquivo' && <ExercicioSelect />}
          <ContaMenu />
        </>
      }
      banner={
        <>
          {usuario?.impersonacao && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning-300 bg-warning-50 px-4 py-2.5 text-sm text-warning-600 sm:px-6 lg:px-8"
            >
              <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <strong>Você está vendo o sistema como {usuario.nome}.</strong> Sessão aberta por {usuario.impersonacao.adminNome} (equipe JEOS) —
                motivo: {usuario.impersonacao.motivo}. Tudo fica registrado.
              </span>
              <button
                type="button"
                onClick={() => void sair()}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 font-semibold hover:bg-warning-500/10"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Encerrar
              </button>
            </div>
          )}
          <DesktopUpdateBanner />
        </>
      }
      switcher={
        ambos && ativo
          ? (compacta) => (
              <SeletorModulo
                ativo={ativo}
                compacta={compacta}
                onTrocar={(s) => {
                  if (s === ativo) return;
                  trocar(s);
                  // Saindo de uma tela do outro modulo: volta ao Inicio do modulo escolhido.
                  if (moduloDaRota(segmento)) router.push(`${base}/dashboard`);
                }}
              />
            )
          : undefined
      }
    >
      {desligados.has(segmento) ? (
        <EmptyState icon={EyeOff} title="Tela indisponível" description="Esta tela foi desligada para o seu órgão. Fale com o administrador." />
      ) : (
        children
      )}
    </AppShell>
  );
}

/** Alterna entre os dois modulos contratados (so aparece quando o orgao tem ambos). */
function SeletorModulo({ ativo, compacta, onTrocar }: { ativo: Sistema; compacta: boolean; onTrocar: (s: Sistema) => void }) {
  return (
    <div role="radiogroup" aria-label="Módulo">
      {!compacta && <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">Módulo</p>}
      <div className={cn('rounded-[12px] bg-white/5 p-1', compacta ? 'flex flex-col gap-1' : 'grid grid-cols-2 gap-1')}>
        {(['financeiro', 'arquivo'] as const).map((id) => {
          const { curto, icon: Icon, solido } = MODULO_VISUAL[id];
          const sel = id === ativo;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={sel}
              title={MODULO_VISUAL[id].nome}
              onClick={() => onTrocar(id)}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-semibold transition-colors',
                compacta ? 'h-10' : 'h-9 px-2',
                sel ? cn(solido, 'text-white shadow-sm') : 'text-white/65 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {!compacta && <span className="truncate">{curto}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
