'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { iniciarImpersonacao } from '@/lib/api';

/**
 * Destino da aba aberta pelo "Entrar como" do superadmin. O token chega no
 * fragmento da URL (#token=...), que nao vai ao servidor; aqui ele vai para a
 * sessao desta aba e some da barra de endereco.
 */
export default function EntrarComoPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setErro(true);
      return;
    }
    iniciarImpersonacao(slug, token);
    router.replace(`/${slug}/modulos`);
  }, [slug, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      {erro ? (
        <div className="w-full max-w-sm rounded-[16px] border border-ink-200/70 bg-surface p-6 text-center shadow-xs">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[12px] bg-warning-50 text-warning-600">
            <ShieldAlert className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-bold text-ink-900">Link inválido</h1>
          <p className="mt-1 text-sm text-ink-500">Abra de novo pelo painel, em "Entrar como".</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-ink-500" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden />
          <p className="text-sm">Abrindo a sessão…</p>
        </div>
      )}
    </div>
  );
}
