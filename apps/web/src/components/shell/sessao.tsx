'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { bootstrapSession } from '@/lib/api';
import { Button } from '@/components/ui/button';

type Estado = 'carregando' | 'pronta' | 'indisponivel';

/**
 * Renova a sessao pelo cookie ao abrir/recarregar a pagina.
 * Sessao expirada vai para o login; API fora do ar (ou sem resposta em 15s)
 * mostra aviso com "Tentar novamente" em vez de travar em "Carregando…".
 */
export function useSessao(slug: string | null, loginPath: string) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>('carregando');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let ativo = true;
    setEstado('carregando');
    void bootstrapSession(slug).then((r) => {
      if (!ativo) return;
      if (r === 'ok') setEstado('pronta');
      else if (r === 'expirada') router.replace(loginPath);
      else setEstado('indisponivel');
    });
    return () => {
      ativo = false;
    };
  }, [slug, loginPath, router, tentativa]);

  const tentarDeNovo = useCallback(() => setTentativa((t) => t + 1), []);
  return { estado, tentarDeNovo };
}

export function TelaSessao({ estado, onTentar }: { estado: Estado; onTentar: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      {estado === 'indisponivel' ? (
        <div className="w-full max-w-sm animate-slide-up rounded-[16px] border border-ink-200/70 bg-surface p-6 text-center shadow-xs">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[12px] bg-warning-50 text-warning-600">
            <WifiOff className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-bold text-ink-900">Não foi possível conectar</h1>
          <p className="mt-1 text-sm text-ink-500">O servidor não respondeu. Verifique a internet e tente de novo.</p>
          <Button className="mt-5 w-full" onClick={onTentar} leftIcon={<RefreshCw aria-hidden />}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-ink-500" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden />
          <p className="text-sm">Carregando…</p>
        </div>
      )}
    </div>
  );
}
