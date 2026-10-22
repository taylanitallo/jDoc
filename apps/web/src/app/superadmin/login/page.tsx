'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Lock } from 'lucide-react';
import { api, setAccessToken, ApiError } from '@/lib/api';
import { removerTemaMarca } from '@/lib/brand-theme';
import { Button, Field, Input } from '@/components/ui';
import { JeosFooter } from '@/components/brand/jeos';

type Resposta = { accessToken: string; mustChangePassword: boolean; must2FASetup: boolean };

/**
 * Login minimo da area restrita: so o cartao centralizado, sem foto, sem nome
 * do sistema e sem texto explicando o que e. Etapa 1 (e-mail e senha) e etapa
 * 2 (codigo do autenticador) no mesmo endpoint: a API responde `mfa_required`
 * quando a senha confere e o 2FA esta ligado.
 */
function Login() {
  const router = useRouter();
  const destino = useSearchParams().get('next');
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const codigoRef = useRef<HTMLInputElement>(null);

  useEffect(() => removerTemaMarca(), []);
  useEffect(() => {
    if (etapa === 2) codigoRef.current?.focus();
  }, [etapa]);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await api<Resposta>('/superadmin/auth/login', {
        method: 'POST',
        body: { email: email.trim(), senha, ...(etapa === 2 ? { totp: codigo } : {}) },
      });
      setAccessToken(r.accessToken);
      const seguro = destino && destino.startsWith('/superadmin') && !destino.startsWith('//') ? destino : '/superadmin';
      router.replace(r.must2FASetup || r.mustChangePassword ? '/superadmin/conta' : seguro);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mfa_required') {
        setEtapa(2);
      } else {
        setErro(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
        if (etapa === 2) setCodigo('');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas px-4">
      {/* Manchas de cor suaves, sem imagem. */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-brand-300/15 blur-3xl" />

      <div className="relative w-full max-w-sm animate-slide-up rounded-[16px] border border-ink-200/70 bg-surface p-6 shadow-md">
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-brand-600 text-white shadow-sm">
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-3 text-lg font-bold text-ink-900">Área restrita</h1>
        </div>

        <form onSubmit={entrar} noValidate className="space-y-4">
          {etapa === 1 ? (
            <>
              <Field label="E-mail" htmlFor="email">
                <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Senha" htmlFor="senha">
                <Input id="senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
              </Field>
            </>
          ) : (
            <Field label="Código" htmlFor="codigo" hint="Digite o código de 6 dígitos do aplicativo autenticador.">
              <Input
                ref={codigoRef}
                id="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="text-center text-lg tracking-[0.3em]"
              />
            </Field>
          )}

          {erro && (
            <p role="alert" className="flex items-center gap-2 rounded-[10px] bg-danger-50 px-3 py-2.5 text-sm text-danger-600 ring-1 ring-inset ring-danger-600/15">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              {erro}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            loading={enviando}
            disabled={etapa === 1 ? !email || !senha : codigo.length !== 6}
          >
            {etapa === 1 ? 'Continuar' : 'Entrar'}
          </Button>
          {etapa === 2 && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              leftIcon={<ArrowLeft aria-hidden />}
              onClick={() => {
                setEtapa(1);
                setCodigo('');
                setErro(null);
              }}
            >
              Voltar
            </Button>
          )}
        </form>

        <JeosFooter className="mt-6" />
      </div>
    </div>
  );
}

export default function SuperadminLoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
