'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@jdoc/shared';
import { Landmark, LogIn, Lock, Mail } from 'lucide-react';
import { api, setAccessToken, ApiError } from '@/lib/api';
import { desktopLoginBestEffort } from '@/lib/desktop-bridge';

export default function LoginPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

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
      router.push(`/${slug}/dashboard`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao entrar. Tente novamente.');
    }
  };

  return (
    <main
      className="relative flex min-h-screen items-center justify-center bg-black bg-cover px-4"
      style={{ backgroundImage: "url('/background.png')", backgroundPosition: 'right center' }}
    >
      <div className="flex w-full max-w-5xl flex-col items-center gap-12 lg:flex-row lg:justify-end">
        {/* A marca (logo + nome + slogan) ja vem desenhada dentro do proprio
            background.png — nao duplicar com outra imagem/texto por cima. */}

        {/* Card de login */}
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-black/60 p-8 shadow-2xl backdrop-blur">
          <div className="mb-6 flex flex-col items-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary">
              <Landmark className="h-8 w-8 text-white" aria-hidden />
            </div>
            <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-app-muted">
              {String(slug).replace(/_/g, ' ')}
            </p>
            <p className="text-xs text-app-muted">Informe suas credenciais</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-bold uppercase text-app-muted">
                E-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-app-muted" aria-hidden />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="seu@email.gov.br"
                  className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder-app-muted outline-none focus:border-accent"
                  {...register('email')}
                />
              </div>
              {errors.email && <p className="mt-1 text-xs text-app-error-text">{errors.email.message}</p>}
            </div>

            <div>
              <label htmlFor="senha" className="mb-1 block text-xs font-bold uppercase text-app-muted">
                Senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-app-muted" aria-hidden />
                <input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder-app-muted outline-none focus:border-accent"
                  {...register('senha')}
                />
              </div>
              {errors.senha && <p className="mt-1 text-xs text-app-error-text">{errors.senha.message}</p>}
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-primary py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" aria-hidden />
              {isSubmitting ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </section>
      </div>

      <footer className="absolute bottom-4 w-full text-center text-xs text-app-muted">
        © 2026 JEOS SISTEMAS E ASSESSORIAS LTDA • V1.0.0
      </footer>
    </main>
  );
}
