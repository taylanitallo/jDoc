'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@jdoc/shared';
import { ShieldCheck, ArrowLeft, Lock } from 'lucide-react';
import { api, setAccessToken, ApiError } from '@/lib/api';
import { cardCls, inputCls, labelCls, btnPrimary } from '@/components/ui';

/**
 * Login em 2 telas distintas: email/senha primeiro, so avanca pra tela de
 * 2FA se as credenciais realmente baterem (checagem real no backend via
 * /check-credentials, nao so validacao de formato). O codigo TOTP fica FORA
 * do react-hook-form — e obrigatorio so quando o superadmin ja tem 2FA
 * habilitado, e no primeiro login (sem 2FA ainda) o campo pode ir vazio.
 */
export default function SuperadminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [totpRequired, setTotpRequired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creds, setCreds] = useState<LoginInput | null>(null);
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onCheckCredentials = async (data: LoginInput) => {
    setError(null);
    setChecking(true);
    try {
      const clean = { email: data.email.trim(), senha: data.senha.trim() };
      const { totpRequired: required } = await api<{ totpRequired: boolean }>(
        '/superadmin/auth/check-credentials',
        { method: 'POST', body: clean },
      );
      setCreds(clean);
      setTotpRequired(required);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao entrar.');
    } finally {
      setChecking(false);
    }
  };

  const [verifying, setVerifying] = useState(false);
  const onVerify = async () => {
    if (!creds) return;
    setError(null);
    setVerifying(true);
    try {
      const result = await api<{ accessToken: string; must2FASetup: boolean }>(
        '/superadmin/auth/login',
        { method: 'POST', body: { ...creds, ...(totp ? { totp: totp.trim() } : {}) } },
      );
      setAccessToken(result.accessToken);
      router.push(result.must2FASetup ? '/superadmin/2fa-setup' : '/superadmin/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao entrar.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-login px-4">
      <section className={`${cardCls} w-full max-w-md p-8`}>
        {step === 1 ? (
          <>
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary">
                <ShieldCheck className="h-8 w-8 text-white" aria-hidden />
              </div>
              <h1 className="mt-3 text-lg font-bold text-app">SuperAdmin</h1>
              <p className="text-xs text-app-muted">Acesso restrito ao administrador geral</p>
            </div>

            <form onSubmit={handleSubmit(onCheckCredentials)} noValidate className="space-y-4">
              <div>
                <label htmlFor="email" className={labelCls}>
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="admin@exemplo.com"
                  className={inputCls}
                  {...register('email')}
                />
                {errors.email && <p className="mt-1 text-xs text-app-error-text">{errors.email.message}</p>}
              </div>

              <div>
                <label htmlFor="senha" className={labelCls}>
                  Senha
                </label>
                <input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  className={inputCls}
                  {...register('senha')}
                />
                {errors.senha && <p className="mt-1 text-xs text-app-error-text">{errors.senha.message}</p>}
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
                  {error}
                </p>
              )}

              <button type="submit" disabled={checking} className={`${btnPrimary} w-full py-2.5 text-sm`}>
                {checking ? 'Verificando…' : 'Continuar'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500">
                <Lock className="h-8 w-8 text-white" aria-hidden />
              </div>
              <h1 className="mt-3 text-lg font-bold text-app">Verificação em 2 etapas</h1>
              <p className="text-xs text-app-muted">
                Digite o código de 6 dígitos do seu aplicativo autenticador
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="totp" className={labelCls}>
                  Código TOTP
                </label>
                <input
                  id="totp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000 000"
                  autoComplete="one-time-code"
                  autoFocus
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${inputCls} text-center text-lg tracking-[0.3em]`}
                />
                {!totpRequired && (
                  <p className="mt-1 text-[11px] text-app-muted">
                    Ainda não configurou? Deixe em branco e configure depois de entrar.
                  </p>
                )}
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={verifying}
                onClick={() => void onVerify()}
                className={`${btnPrimary} w-full py-2.5 text-sm`}
              >
                {verifying ? 'Verificando…' : 'Verificar'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setTotp('');
                  setStep(1);
                }}
                className="flex w-full items-center justify-center gap-1 text-xs font-semibold text-app-muted hover:text-app"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Voltar ao login
              </button>
            </div>
          </>
        )}

        <Link
          href="/"
          className="mt-6 block text-center text-xs font-semibold text-app-muted hover:text-app"
        >
          ← Voltar ao início
        </Link>
      </section>
    </main>
  );
}
