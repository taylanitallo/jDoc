import { useState, type FormEvent } from 'react';
import type { SessionView } from '../types';

interface TenantChoice {
  slug: string;
  nome: string;
  brasaoUrl: string | null;
}

type ResolveLoginResult =
  | { status: 'entered'; session: SessionView }
  | { status: 'choose'; tenants: TenantChoice[] };

/**
 * Tela de login do desktop — visual JEOS dark.
 * So e-mail + senha: o usuario nao precisa saber/digitar o slug do orgao.
 * O main tenta as credenciais em todos os orgaos ativos e:
 * - 1 orgao bateu -> entra direto (fecha esta janela, abre o site logado).
 * - 2+ orgaos bateram -> mostra a lista pra escolher (2º passo aqui).
 */
export function LoginScreen({
  onSuccess,
  notice,
}: {
  onSuccess: (session: SessionView) => void;
  notice?: string | null;
}) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState<TenantChoice[] | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = (await window.jdoc.invoke('auth:resolve', {
        email: email.trim(),
        senha,
      })) as ResolveLoginResult;

      if (result.status === 'entered') {
        onSuccess(result.session);
      } else {
        setTenants(result.tenants);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.');
    } finally {
      setLoading(false);
    }
  }

  async function handleChoose(slug: string) {
    setError(null);
    setLoading(true);
    try {
      const session = (await window.jdoc.invoke('auth:select-tenant', { slug })) as SessionView;
      onSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar.');
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

        {tenants ? (
          <div className="login-tenant-list">
            <p className="login-tenant-hint">Você está vinculado a mais de um órgão. Escolha qual acessar:</p>
            {tenants.map((t) => (
              <button
                key={t.slug}
                type="button"
                className="login-tenant-item"
                disabled={loading}
                onClick={() => void handleChoose(t.slug)}
              >
                {t.brasaoUrl ? (
                  <img src={t.brasaoUrl} alt="" className="login-tenant-brasao" />
                ) : (
                  <span className="login-tenant-brasao login-tenant-brasao--placeholder" aria-hidden />
                )}
                <span className="login-tenant-info">
                  <span className="login-tenant-nome">{t.nome}</span>
                  <span className="login-tenant-slug">/{t.slug}</span>
                </span>
              </button>
            ))}

            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}

            <button
              type="button"
              className="login-back"
              disabled={loading}
              onClick={() => {
                setTenants(null);
                setError(null);
              }}
            >
              ← Voltar
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="email" className="login-label">
                Digite o seu e-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                className="login-input"
                placeholder="voce@orgao.gov.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="login-field">
              <label htmlFor="senha" className="login-label">
                Digite a sua senha para acesso
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
              {loading ? 'Entrando…' : 'Partiu, entrar no sistema'}
            </button>
          </form>
        )}

        <footer className="login-foot">jDoc Desktop</footer>
      </section>
    </main>
  );
}
