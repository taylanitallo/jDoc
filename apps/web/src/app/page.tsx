'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { isDesktopApp } from '@/lib/desktop-bridge';

const DESKTOP_DOWNLOAD_URL =
  'https://buknzokboidzhenafwpi.supabase.co/storage/v1/object/public/downloads/jDoc-Desktop-1.0.0-x64.exe';

/**
 * Landing da raiz do site — sem tenant na URL ainda. Alem de servir o
 * navegador comum sem link direto do orgao, e a TELA INICIAL do jDoc
 * Desktop (a janela do executavel carrega esta origem sem slug nenhum).
 * Por isso precisa de um jeito de seguir adiante, nao so um aviso estatico.
 */
export default function Home() {
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = slug.trim().toLowerCase();
    if (clean) router.push(`/${clean}/login`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-login login-circuit px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="bg-gradient-primary bg-clip-text text-5xl font-extrabold text-transparent">
          jDoc
        </h1>
        <p className="mt-3 text-sm text-app-muted">
          Sistema de Gestão Eletrônica de Documentos
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-left shadow-2xl backdrop-blur">
          <label htmlFor="slug" className="block text-xs font-bold uppercase text-app-muted">
            Órgão (slug)
          </label>
          <input
            id="slug"
            type="text"
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="camara_exemplo"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-app-muted outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!slug.trim()}
            className="w-full rounded-lg bg-gradient-primary py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Continuar
          </button>
        </form>

        {!desktop && (
          <a
            href={DESKTOP_DOWNLOAD_URL}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 py-2.5 text-xs font-bold uppercase tracking-wide text-app-muted transition hover:border-accent hover:text-white"
          >
            <Download className="h-4 w-4" aria-hidden />
            Baixar o jDoc Desktop (Windows)
          </a>
        )}

        <p className="mt-8 text-xs text-app-muted">
          © 2026{' '}
          <a
            href="https://jeossistemas.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white hover:underline"
          >
            JEOS SISTEMAS E ASSESSORIAS LTDA
          </a>{' '}
          • V1.0.0
        </p>
      </div>
    </main>
  );
}
