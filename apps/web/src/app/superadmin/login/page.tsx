'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@jdoc/shared';
import { ShieldCheck, ArrowLeft, Lock } from 'lucide-react';
import { api, setAccessToken, ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/shell/auth-layout';
import { Card, inputCls, labelCls, btnPrimary } from '@/components/ui';

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
    <AuthLayout>
      <Card className="p-5 sm:p-6">
        {step === 1 ? (
          <>
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-600/15">
                <ShieldCheck className="h-6 w-6" aria-hidden />
              </div>
              <h1 className="mt-3 text-xl font-extrabold tracking-tight text-ink-900">SuperAdmin</h1>
              <p className="mt-0.5 text-sm text-ink-500">Acesso restrito ao administrador geral</p>
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
                {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
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
                {errors.senha && <p className="mt-1 text-xs text-danger-600">{errors.senha.message}</p>}
              </div>

              {error && (
                <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2.5 text-sm text-danger-600 ring-1 ring-inset ring-danger-600/15">
                  {error}
                </p>
              )}

              <button type="submit" disabled={checking} className={`${btnPrimary} h-12 w-full rounded-[12px]`}>
                {checking ? 'Verificando…' : 'Continuar'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-warning-50 text-warning-600 ring-1 ring-inset ring-warning-600/15">
                <Lock className="h-6 w-6" aria-hidden />
              </div>
              <h1 className="mt-3 text-xl font-extrabold tracking-tight text-ink-900">Verificação em 2 etapas</h1>
              <p className="mt-0.5 text-sm text-ink-500">
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
                  <p className="mt-1 text-[11px] text-ink-500">
                    Ainda não configurou? Deixe em branco e configure depois de entrar.
                  </p>
                )}
              </div>

              {error && (
                <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2.5 text-sm text-danger-600 ring-1 ring-inset ring-danger-600/15">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={verifying}
                onClick={() => void onVerify()}
                className={`${btnPrimary} h-12 w-full rounded-[12px]`}
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
                className="flex w-full items-center justify-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Voltar ao login
              </button>
            </div>
          </>
        )}

        <Link
          href="/"
          className="mt-6 flex items-center justify-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar ao início
        </Link>
      </Card>
    </AuthLayout>
  );
}
