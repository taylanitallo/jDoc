import { useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import type { SessionView } from './types';

/**
 * Janela de login nativa. A restauracao de sessao (keychain) acontece no
 * processo main ANTES desta janela sequer ser criada (ver main.ts) — se
 * chegou aqui, e porque nao havia sessao valida. Ao logar com sucesso, o
 * main abre a janela principal (site) e fecha esta; nao ha um "Shell"
 * proprio pra renderizar depois do login.
 */
export function App() {
  const [notice] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('notice');
  });
  const [entering, setEntering] = useState(false);

  function handleSuccess(_session: SessionView): void {
    // A janela principal ja esta sendo aberta pelo main; so mantem um
    // estado visual de "entrando" ate esta janela fechar.
    setEntering(true);
  }

  if (entering) {
    return (
      <div className="boot-splash">
        <span>Entrando…</span>
      </div>
    );
  }

  return <LoginScreen notice={notice} onSuccess={handleSuccess} />;
}
