'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { JeosFooter } from '@/components/brand/jeos';
import { NovaSenhaForm } from '@/components/conta/nova-senha-form';
import { TelaSessao, useSessao } from '@/components/shell/sessao';

/**
 * "Escolha a sua senha" (padrao JEOS): quem entra com senha provisoria passa
 * por aqui antes de qualquer tela do sistema. `precisaMfa` deve ser estavel
 * (funcao de modulo): a tela decide com ela para onde ir depois da troca.
 */
export function TrocaObrigatoria<T extends { nome: string; mustChangePassword: boolean }>({
  slug,
  loginPath,
  rotaMe,
  rotaSenha,
  minimo,
  inicio,
  contaMfa,
  precisaMfa,
}: {
  slug: string | null;
  loginPath: string;
  rotaMe: string;
  rotaSenha: string;
  minimo: number;
  inicio: string;
  /** Destino quando ainda falta configurar a verificacao em 2 etapas. */
  contaMfa: string;
  precisaMfa: (conta: T) => boolean;
}) {
  const router = useRouter();
  const { estado, tentarDeNovo } = useSessao(slug, loginPath);
  const [conta, setConta] = useState<T | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (estado !== 'pronta') return;
    let ativo = true;
    api<T>(rotaMe)
      .then((c) => {
        if (!ativo) return;
        if (c.mustChangePassword) setConta(c);
        else router.replace(precisaMfa(c) ? contaMfa : inicio);
      })
      .catch(() => {
        if (ativo) setFalhou(true);
      });
    return () => {
      ativo = false;
    };
  }, [estado, rotaMe, router, precisaMfa, contaMfa, inicio]);

  if (!conta) {
    return (
      <TelaSessao
        estado={falhou || estado === 'indisponivel' ? 'indisponivel' : 'carregando'}
        onTentar={() => {
          setFalhou(false);
          tentarDeNovo();
        }}
      />
    );
  }

  const salvar = async (novaSenha: string) => {
    setErro(null);
    setEnviando(true);
    try {
      await api(rotaSenha, { method: 'POST', body: { novaSenha } });
      router.replace(precisaMfa(conta) ? contaMfa : inicio);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar a senha.');
      setEnviando(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[420px] animate-slide-up rounded-[16px] border border-ink-200/70 bg-surface p-6 shadow-md sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-brand-600 text-white">
            <KeyRound className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-lg font-extrabold tracking-tight text-ink-900">Escolha a sua senha</h1>
        </div>
        <p className="mb-5 text-sm text-ink-600">
          Olá, <strong className="text-ink-900">{conta.nome}</strong>. Você entrou com uma senha provisória. Crie agora a senha que vai usar nos
          próximos acessos.
        </p>
        <NovaSenhaForm minimo={minimo} textoBotao="Salvar e entrar" enviando={enviando} erro={erro} onEnviar={salvar} />
      </div>
      <JeosFooter className="mt-6" />
    </div>
  );
}
