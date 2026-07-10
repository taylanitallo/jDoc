import { useEffect, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Janela "Atualizador" (electron-updater). Mostra a versao atual -> nova, um
 * botao "Executar atualizacao" e a barra de progresso do download. Ao concluir,
 * mostra "Atualizacao concluida" e o app reinicia sozinho na versao nova.
 *
 * A ponte com o main vive em window.jdoc (preload). Sem deps externas.
 */

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function UpdateIcon(): ReactElement {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

type Phase = 'idle' | 'downloading' | 'done';

function Atualizador(): ReactElement {
  const [info, setInfo] = useState<UpdateInfo>({ currentVersion: '', latestVersion: null });
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const v = (await window.jdoc.invoke('app:version')) as { version?: string };
        const st = (await window.jdoc.invoke('app:check-update')) as { latestVersion?: string | null };
        setInfo({ currentVersion: v?.version ?? '', latestVersion: st?.latestVersion ?? null });
      } catch {
        /* mantem placeholders */
      }
    })();

    const offProgress = window.jdoc.onUpdateProgress((s) => {
      setPercent(Math.max(0, Math.min(100, Number(s.percent) || 0)));
      setTransferred(Number(s.transferred) || 0);
      setTotal(Number(s.total) || 0);
    });
    const offReady = window.jdoc.onUpdateReady(() => {
      setPercent(100);
      setPhase('done');
    });
    return () => {
      offProgress();
      offReady();
    };
  }, []);

  async function executar() {
    setError(null);
    setPhase('downloading');
    try {
      const r = (await window.jdoc.invoke('update:download')) as { ok?: boolean; error?: string };
      if (!r?.ok) {
        setError(r?.error ?? 'Nao foi possivel baixar a atualizacao.');
        setPhase('idle');
      }
      // sucesso: os eventos de progresso/ready cuidam do resto.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao atualizar.');
      setPhase('idle');
    }
  }

  const target = info.latestVersion ?? '—';
  const sizeLabel = total > 0 ? `${formatBytes(transferred)} de ${formatBytes(total)}` : '';

  return (
    <div className="up-screen">
      <div className="up-card">
        <div className="up-icon">
          <UpdateIcon />
        </div>
        <h1 className="up-title">Atualizador</h1>
        <p className="up-subtitle">
          É muito importante manter o sistema sempre atualizado. Temos uma nova versão do jDoc pronta para você.
        </p>

        <hr className="up-divider" />

        <div className="up-versions">
          <span className="up-label">Versão atual:</span>
          <code className="up-version">{info.currentVersion || '—'}</code>
          <span className="up-arrow">→</span>
          <span className="up-label">Nova versão:</span>
          <code className="up-version">{target}</code>
        </div>

        {phase === 'idle' && (
          <>
            <button type="button" className="up-btn" onClick={() => void executar()}>
              ⭳ Executar atualização
            </button>
            {error && <p className="up-error">{error}</p>}
          </>
        )}

        {phase === 'downloading' && (
          <>
            <div className="up-progress" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
              <div className="up-progress-fill" style={{ width: `${percent}%` }} />
              <span className="up-progress-label">{Math.round(percent)}%</span>
            </div>
            <p className="up-foot">Baixando atualização… {sizeLabel}</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="up-progress">
              <div className="up-progress-fill" style={{ width: '100%' }} />
              <span className="up-progress-label">100%</span>
            </div>
            <p className="up-foot up-foot-ok">✓ Atualização concluída — abrindo o jDoc…</p>
          </>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Atualizador />);
}

/* --- CSS local ------------------------------------------------------------ */

const style = document.createElement('style');
style.textContent = `
:root {
  --app-bg: #0f1424;
  --app-card: #1a2036;
  --app-border: #2d3550;
  --app-text: #e5e7eb;
  --app-muted: #9ca3af;
  --app-input-bg: #1a2036;
  --app-input-border: #3a4366;
  --neon-violet: #a855f7;
  --neon-purple: #7c3aed;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--app-bg);
  color: var(--app-text);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.up-screen {
  display: flex;
  height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(168, 85, 247, 0.12) 0, transparent 40%),
    radial-gradient(circle at 80% 70%, rgba(217, 70, 239, 0.1) 0, transparent 40%),
    linear-gradient(rgba(124, 58, 237, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(124, 58, 237, 0.05) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 48px 48px, 48px 48px;
}
.up-card {
  width: 100%;
  max-width: 28rem;
  padding: 1.75rem;
  border: 1px solid var(--app-border);
  border-radius: 1rem;
  background: var(--app-card);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  text-align: center;
}
.up-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 4rem;
  width: 4rem;
  border-radius: 9999px;
  background: linear-gradient(135deg, var(--neon-purple), var(--neon-violet));
  color: #fff;
  margin-bottom: 0.85rem;
}
.up-title { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 700; color: #fff; }
.up-subtitle { margin: 0 auto 1rem; max-width: 22rem; font-size: 0.78rem; color: var(--app-muted); line-height: 1.4; }
.up-divider { margin: 1rem 0; border: none; border-top: 1px solid var(--app-border); }
.up-versions {
  display: flex; align-items: center; justify-content: center; gap: 0.45rem;
  flex-wrap: wrap; font-size: 0.8rem; margin-bottom: 1.1rem;
}
.up-label { color: var(--app-muted); }
.up-version {
  padding: 0.15rem 0.5rem; border-radius: 0.35rem;
  background: var(--app-input-bg); border: 1px solid var(--app-border);
  color: var(--app-text); font-size: 0.78rem;
}
.up-arrow { color: var(--neon-violet); }
.up-btn {
  width: 100%; padding: 0.7rem; border: none; border-radius: 0.6rem;
  background: linear-gradient(135deg, var(--neon-purple), var(--neon-violet));
  color: #fff; font-size: 0.9rem; font-weight: 700; cursor: pointer;
  transition: opacity 0.15s ease;
}
.up-btn:hover { opacity: 0.9; }
.up-progress {
  position: relative; height: 1.6rem; border-radius: 9999px; overflow: hidden;
  border: 1px solid var(--app-input-border); background: var(--app-input-bg);
  margin: 0.25rem 0 0.85rem;
}
.up-progress-fill {
  height: 100%; background: linear-gradient(90deg, var(--neon-purple), var(--neon-violet));
  transition: width 0.25s ease;
}
.up-progress-label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 0.78rem; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
.up-foot { margin: 0; font-size: 0.75rem; color: var(--app-muted); }
.up-foot-ok { color: #6ee7b7; font-weight: 700; }
.up-error { margin: 0.75rem 0 0; font-size: 0.78rem; color: #fca5a5; }
`;
document.head.appendChild(style);
