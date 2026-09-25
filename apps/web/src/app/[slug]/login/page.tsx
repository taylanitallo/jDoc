'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput, type TenantBranding } from '@jdoc/shared';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Download, Eye, EyeOff, Landmark, LogIn, Lock, Mail } from 'lucide-react';
import { api, setAccessToken, ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/shell/auth-layout';
import { Button, Card, Field, Input, buttonClasses } from '@/components/ui';
import { desktopLoginBestEffort, isDesktopApp } from '@/lib/desktop-bridge';

const DESKTOP_DOWNLOAD_URL =
  'https://buknzokboidzhenafwpi.supabase.co/storage/v1/object/public/downloads/jDoc-Desktop-1.0.4-x64.exe';

export default function LoginPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showSenha, setShowSenha] = useState(false);
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [desktop, setDesktop] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  // Sem QueryClientProvider nesta tela (so existe dentro do grupo (app), pos-login)
  // — busca simples, so pra mostrar o brasao/nome reais antes de autenticar.
  useEffect(() => {
    let active = true;
    api<TenantBranding>(`/t/${slug}/configuracoes/public-branding`)
      .then((b) => { if (active) setBranding(b); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

  const onSubmit = async (data: LoginInput) => {
    setError(null);
    try {
      const result = await api<{ accessToken: string }>(`/t/${slug}/auth/login`, {
        method: 'POST',
        body: data,
      });
      setAccessToken(result.accessToken);
      // Best-effort: estabelece tambem a sessao nativa (fila/assinatura/pasta
      // monitorada) quando rodando dentro do jDoc Desktop. Nao bloqueia nem
      // falha o login do site se o app nativo nao estiver disponivel.
      desktopLoginBestEffort(slug, data.email, data.senha);
      // Com os dois modulos contratados, a tela de escolha decide; com um so, ela segue direto ao Inicio.
      router.push(`/${slug}/modulos`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao entrar. Tente novamente.');
    }
  };

  const nome = branding?.nomeExibido || branding?.nomeOrgao || String(slug).replace(/_/g, ' ');

  return (
    <AuthLayout>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-600/15">
          {branding?.brasaoUrl ? (
            <img src={branding.brasaoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Landmark className="h-6 w-6" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold uppercase leading-tight tracking-tight text-ink-900 sm:text-2xl" title={nome}>{nome}</h1>
          <p className="text-sm text-ink-500">Entre com seu e-mail e senha</p>
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Field label="E-mail" htmlFor="email" required error={errors.email?.message}>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="seu@email.gov.br"
                className="pl-9"
                invalid={!!errors.email}
                {...register('email')}
              />
            </div>
          </Field>

          <Field label="Senha" htmlFor="senha" required error={errors.senha?.message}>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input
                id="senha"
                type={showSenha ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••••"
                className="pl-9 pr-10"
                invalid={!!errors.senha}
                {...register('senha')}
              />
              <button
                type="button"
                onClick={() => setShowSenha((v) => !v)}
                aria-label={showSenha ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[8px] text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                {showSenha ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </Field>

          {error && (
            <p role="alert" className="flex items-center gap-2 rounded-[10px] bg-danger-50 px-3 py-2.5 text-sm text-danger-600 ring-1 ring-inset ring-danger-600/15">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={isSubmitting} leftIcon={<LogIn aria-hidden />}>
            {isSubmitting ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>

      <div className="mt-4 flex flex-col items-center gap-3 text-sm">
        {!desktop && (
          <a href={DESKTOP_DOWNLOAD_URL} className={buttonClasses('outline', 'md', 'w-full')}>
            <Download aria-hidden />
            Baixar o jDoc Desktop (Windows)
          </a>
        )}
        <Link href="/" className="inline-flex items-center gap-1 font-medium text-ink-500 hover:text-ink-800">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Trocar de órgão
        </Link>
      </div>
    </AuthLayout>
  );
}
