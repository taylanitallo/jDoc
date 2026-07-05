import { useState, type FormEvent } from 'react';
import type { SessionView } from '../types';

/**
 * Tela de login do desktop — visual JEOS dark.
 * Coleta slug do orgao + e-mail + senha e delega ao MAIN via
 * `jdoc.invoke('auth:login')`. O renderer nunca ve token nem faz fetch.
 */
export function LoginScreen({
  onSuccess,
  notice,
}: {
  onSuccess: (session: SessionView) => void;
  notice?: string | null;
}) {
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = (await window.jdoc.invoke('auth:login', {
        slug: slug.trim(),
        email: email.trim(),
        senha,
      })) as SessionView;
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <header className="login-head">
          <div className="login-badge" aria-hidden>
            jD
          </div>
          <h1 className="login-title">jDoc Desktop</h1>
          <p className="login-subtitle">Gestão eletrônica de documentos — JEOS Sistemas</p>
        </header>

        {notice && (
          <p role="status" className="login-notice">
            {notice}
          </p>
        )}

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="slug" className="login-label">
              Órgão (slug)
            </label>
            <input
              id="slug"
              name="slug"
              autoComplete="organization"
              className="login-input"
              placeholder="camara_exemplo"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>

          <div className="login-field">
            <label htmlFor="email" className="login-label">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              className="login-input"
              placeholder="voce@orgao.gov.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="login-field">
            <label htmlFor="senha" className="login-label">
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              className="login-input"
              placeholder="••••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="login-error">
              {error}
            </p>
          )}

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <footer className="login-foot">Marco 2 — auth + sessão segura</footer>
      </section>
    </main>
  );
}
