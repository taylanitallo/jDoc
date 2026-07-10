'use client';

import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { isDesktopApp, desktopInvoke } from '@/lib/desktop-bridge';

/**
 * Banner de atualizacao do jDoc Desktop. So aparece DENTRO do executavel
 * (nunca no navegador) e so quando a versao instalada esta atras da mais
 * recente publicada. Vive no site porque o site e carregado por TODAS as
 * versoes do desktop (inclusive as antigas, que nao tem o auto-update embutido)
 * — e a unica forma de alcancar quem ja instalou uma versao velha.
 *
 * Fluxo do botao:
 *  - Tenta o auto-update embutido (app:check-update). Nas versoes novas, com o
 *    feed configurado, isso baixa e reinstala sozinho (sem o usuario baixar
 *    nada) e o app reinicia.
 *  - Se o app nao consegue se auto-atualizar (versao antiga com feed placeholder,
 *    ou erro), cai no download do instalador novo — um clique, instala por cima.
 */

/** JSON simples publicado junto do instalador no bucket de downloads. */
const VERSION_URL =
  'https://buknzokboidzhenafwpi.supabase.co/storage/v1/object/public/downloads/version.json';

interface LatestInfo {
  version: string;
  url: string;
}

/** a < b em ordem semver (major.minor.patch). */
function isOlder(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Corre uma promise contra um timeout — evita travar esperando o feed morto. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

type State = 'hidden' | 'available' | 'updating';

export function DesktopUpdateBanner() {
  const [state, setState] = useState<State>('hidden');
  const [latest, setLatest] = useState<LatestInfo | null>(null);
  const [current, setCurrent] = useState<string>('');

  useEffect(() => {
    if (!isDesktopApp()) return;
    let alive = true;
    void (async () => {
      try {
        const v = await desktopInvoke<{ version: string }>('app:version');
        const cur = v?.version ?? '';
        const res = await fetch(VERSION_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const info = (await res.json()) as LatestInfo;
        if (!alive || !info?.version || !cur) return;
        setCurrent(cur);
        setLatest(info);
        if (isOlder(cur, info.version)) setState('available');
      } catch {
        // sem info de versao / offline — nao mostra nada.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleUpdate() {
    setState('updating');
    try {
      // Auto-update embutido: nas versoes novas (feed OK) baixa e reinstala
      // sozinho; o app reinicia. Timeout curto porque a versao antiga tem feed
      // placeholder e a checagem falha rapido.
      const r = await withTimeout(
        desktopInvoke<{ updateAvailable?: boolean; error?: string | null }>('app:check-update'),
        6000,
      );
      if (r?.updateAvailable) return; // app assumiu: baixando + reinicia sozinho
      throw new Error(r?.error ?? 'sem auto-update');
    } catch {
      // Versao antiga / sem auto-update: baixa o instalador novo (instala por cima).
      if (latest?.url) window.open(latest.url, '_blank', 'noopener');
      setState('available');
    }
  }

  if (state === 'hidden') return null;

  return (
    <div className="flex items-center gap-3 border-b border-neon-purple/40 bg-gradient-to-r from-purple-600/15 to-fuchsia-600/15 px-4 py-2.5">
      <RefreshCw className="h-4 w-4 shrink-0 text-neon-violet" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-app">
        <b>Atualização disponível</b>
        {latest?.version && current ? (
          <span className="text-app-muted">
            {' '}
            — versão {current} → {latest.version}
          </span>
        ) : null}
      </p>
      <button
        type="button"
        onClick={() => void handleUpdate()}
        disabled={state === 'updating'}
        className="flex shrink-0 items-center gap-2 rounded-lg bg-gradient-primary px-4 py-1.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        <Download className="h-4 w-4" aria-hidden />
        {state === 'updating' ? 'Atualizando…' : 'Atualizar'}
      </button>
    </div>
  );
}
