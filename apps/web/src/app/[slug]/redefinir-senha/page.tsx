'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Loader2, TimerOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { removerTemaMarca } from '@/lib/brand-theme';
import { AuthLayout } from '@/components/shell/auth-layout';
import { Card } from '@/components/ui';
import { NovaSenhaForm } from '@/components/conta/nova-senha-form';

type Estado = 'conferindo' | 'valido' | 'invalido' | 'pronto';

/** Destino do link do e-mail de recuperacao (?token=...). */
function Redefinir() {
  const { slug } = useParams<{ slug: string }>();
  const token = useSearchParams().get('token') ?? '';
  const [estado, setEstado] = useState<Estado>('conferindo');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    removerTemaMarca();
    if (!/^[0-9a-f]{64}$/.test(token)) {
      setEstado('invalido');
      return;
    }
    api<{ valido: boolean }>(`/t/${slug}/auth/redefinir-senha/validar`, { method: 'POST', body: { token } })
      .then((r) => setEstado(r.valido ? 'valido' : 'invalido'))
      .catch(() => setEstado('invalido'));
  }, [slug, token]);

  const salvar = async (novaSenha: string) => {
    setErro(null);
    setEnviando(true);
    try {
      await api(`/t/${slug}/auth/redefinir-senha`, { method: 'POST', body: { token, novaSenha } });
      setEstado('pronto');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível criar a nova senha.');
    } finally {
      setEnviando(false);
    }
  };

  const Icone = estado === 'pronto' ? CheckCircle2 : estado === 'invalido' ? TimerOff : KeyRound;
  return (
    <AuthLayout>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-600/15">
          <Icone className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-2xl">
            {estado === 'pronto' ? 'Senha criada' : estado === 'invalido' ? 'Link vencido' : 'Criar nova senha'}
          </h1>
          <p className="text-sm text-ink-500">
            {estado === 'invalido' ? 'O link já foi usado ou passou de 1 hora.' : estado === 'pronto' ? 'Já pode entrar com a nova senha.' : 'Escolha uma senha pessoal.'}
          </p>
        </div>
      </div>
      <Card className="p-5 sm:p-6">
        {estado === 'conferindo' && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-500" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden /> Conferindo o link…
          </div>
        )}
        {estado === 'valido' && <NovaSenhaForm enviando={enviando} erro={erro} onEnviar={salvar} />}
        {estado === 'invalido' && (
          <Link href={`/${slug}/esqueci-senha`} className="flex h-12 w-full items-center justify-center rounded-[12px] bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700">
            Pedir um novo link
          </Link>
        )}
        {estado === 'pronto' && (
          <Link href={`/${slug}/login`} className="flex h-12 w-full items-center justify-center rounded-[12px] bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700">
            Ir para o login
          </Link>
        )}
      </Card>
    </AuthLayout>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <Suspense>
      <Redefinir />
    </Suspense>
  );
}
