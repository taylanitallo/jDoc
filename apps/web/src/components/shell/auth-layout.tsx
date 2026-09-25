import type { ReactNode } from 'react';
import { Archive, FileSearch, FolderOpen, QrCode } from 'lucide-react';

const DESTAQUES = [
  { icon: FolderOpen, texto: 'Financeiro/Contábil e Arquivo em um só lugar' },
  { icon: Archive, texto: 'Plano de classificação e tabela de temporalidade' },
  { icon: FileSearch, texto: 'Busca no conteúdo dos documentos (OCR)' },
  { icon: QrCode, texto: 'Autenticidade pública por QR code' },
];

/**
 * Moldura das telas publicas (escolha de orgao, login, superadmin).
 * Desktop: painel escuro da marca a esquerda + formulario a direita.
 * Mobile: so o formulario, com a marca compacta acima.
 */
export function AuthLayout({ children, footer = true }: { children: ReactNode; footer?: boolean }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="relative hidden w-[44%] max-w-[560px] flex-col justify-between overflow-hidden bg-[#0f172a] p-10 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600/25 blur-3xl"
        />
        <Marca />
        <div className="relative">
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight">
            Gestão de documentos públicos, do arquivo ao balancete.
          </h2>
          <ul className="mt-8 space-y-4">
            {DESTAQUES.map(({ icon: Icon, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-sm text-white/75">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/10">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">JEOS Sistemas e Assessorias</p>
      </aside>

      <div className="flex flex-1 flex-col">
        <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
          <div className="w-full max-w-md animate-slide-up">
            <div className="mb-8 lg:hidden">
              <Marca escura />
            </div>
            {children}
          </div>
        </main>
        {footer && (
          <footer className="px-4 pb-6 text-center text-xs text-ink-500">
            © 2026{' '}
            <a
              href="https://jeossistemas.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:text-ink-800 hover:underline"
            >
              JEOS Sistemas e Assessorias Ltda
            </a>{' '}
            · v1.0.5
          </footer>
        )}
      </div>
    </div>
  );
}

function Marca({ escura = false }: { escura?: boolean }) {
  return (
    <div className="relative flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600 text-white">
        <FolderOpen className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="leading-tight">
        <p className={escura ? 'text-[15px] font-bold text-ink-900' : 'text-[15px] font-bold text-white'}>jDoc</p>
        <p className={escura ? 'text-xs text-ink-500' : 'text-xs text-white/50'}>Gestão eletrônica de documentos</p>
      </div>
    </div>
  );
}
