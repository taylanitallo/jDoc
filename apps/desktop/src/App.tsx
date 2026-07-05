import { useEffect, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { Shell } from './components/Shell';
import type { SessionView } from './types';

/**
 * Shell do app. No boot tenta restaurar a sessao do keychain (auth:session).
 * Reage a expiracao por inatividade (onSessionExpired) voltando ao login.
 */
export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const restored = (await window.jdoc.invoke('auth:session')) as SessionView | null;
        if (alive && restored) setSession(restored);
      } finally {
        if (alive) setBooting(false);
      }
    })();

    const off = window.jdoc.onSessionExpired(() => {
      setSession(null);
      setNotice('Sua sessão expirou por inatividade. Entre novamente.');
    });

    return () => {
      alive = false;
      off();
    };
  }, []);

  if (booting) {
    return (
      <div className="boot-splash">
        <span>Carregando…</span>
      </div>
    );
  }

  if (session) {
    return <Shell session={session} onLogout={() => setSession(null)} />;
  }

  return (
    <LoginScreen
      notice={notice}
      onSuccess={(s) => {
        setNotice(null);
        setSession(s);
      }}
    />
  );
}
