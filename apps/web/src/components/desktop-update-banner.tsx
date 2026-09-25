'use client';

import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { isDesktopApp, desktopInvoke } from '@/lib/desktop-bridge';
import { buttonClasses } from '@/components/ui';

/**
 * Banner de atualizacao para as versoes LEGADAS do jDoc Desktop — as anteriores
 * ao "Atualizador" embutido (< 1.0.1), que nao conseguem se auto-atualizar
 * (feed placeholder). Vive no site porque o site e carregado por todas as
 * versoes do desktop, entao e a unica forma de alcancar quem instalou uma
 * versao velha e leva-lo a baixar o instalador novo.
 *
 * Nas versoes 1.0.1+, o proprio app abre a janela "Atualizador" (com barra de
 * progresso, sem baixar nada manualmente) apos o login — entao este banner NAO
 * aparece nelas (seria redundante).
 */

/** JSON publicado junto do instalador no bucket de downloads. */
const VERSION_URL =
  'https://buknzokboidzhenafwpi.supabase.co/storage/v1/object/public/downloads/version.json';

/** Primeira versao com o Atualizador embutido; abaixo disso, so download manual. */
const AUTO_UPDATE_FROM = '1.0.1';

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

export function DesktopUpdateBanner() {
  const [show, setShow] = useState(false);
  const [latest, setLatest] = useState<LatestInfo | null>(null);
  const [current, setCurrent] = useState('');

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
        // So mostra para versoes LEGADAS (sem Atualizador embutido) que estao
        // atras da publicada. Da 1.0.1 em diante o proprio app cuida.
        if (isOlder(cur, info.version) && isOlder(cur, AUTO_UPDATE_FROM)) setShow(true);
      } catch {
        /* sem info / offline — nao mostra nada. */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="flex items-center gap-3 border-b border-brand-500/30 bg-brand-50 px-4 py-2.5">
      <RefreshCw className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-ink-800">
        <b>Atualização disponível</b>
        {latest?.version && current ? (
          <span className="text-ink-500">
            {' '}
            — versão {current} → {latest.version}
          </span>
        ) : null}
      </p>
      <a
        href={latest?.url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses('primary', 'sm')}
      >
        <Download className="h-4 w-4" aria-hidden />
        Atualizar
      </a>
    </div>
  );
}
