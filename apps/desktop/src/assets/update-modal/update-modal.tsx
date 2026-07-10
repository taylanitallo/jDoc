import { useEffect, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Janela-filha modal de atualizacao (electron-updater).
 * Mostra a barra de progresso do download e avisa o usuario que o app vai
 * reiniciar sozinho assim que chegar a 100% (sem clique necessario).
 *
 * A ponte com o main vive em window.jdoc (preload). Sem deps externas.
 */

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloaded: boolean;
  error: string | null;
};

const EMPTY: UpdateInfo = {
  currentVersion: '0.0.0',
  latestVersion: null,
  updateAvailable: false,
  downloaded: false,
  error: null,
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

function AppUpdateModal(): ReactElement {
  const [info, setInfo] = useState<UpdateInfo>(EMPTY);
  const [percent, setPercent] = useState<number>(0);
  const [transferred, setTransferred] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void window.jdoc
      .invoke('app:check-update')
      .then((res) => {
        if (cancelled) return;
        const r = res as Partial<UpdateInfo> | null;
        if (r && typeof r.currentVersion === 'string') {
          setInfo({
            currentVersion: r.currentVersion,
            latestVersion: typeof r.latestVersion === 'string' ? r.latestVersion : null,
            updateAvailable: Boolean(r.updateAvailable),
            downloaded: Boolean(r.downloaded),
            error: null,
          });
        }
      })
      .catch(() => {
        /* a modal ja mostra fallback abaixo */
      });

    const offProgress = window.jdoc.onUpdateProgress((snapshot) => {
      const p = Math.max(0, Math.min(100, Number(snapshot.percent) || 0));
      setPercent(p);
      setTransferred(Number(snapshot.transferred) || 0);
      setTotal(Number(snapshot.total) || 0);
    });
    const offReady = window.jdoc.onUpdateReady(() => {
      setReady(true);
    });

    return () => {
      cancelled = true;
      offProgress();
      offReady();
    };
  }, []);

  const targetVersion = info.latestVersion ?? '—';
  const percentLabel = `${Math.round(percent)}%`;
  const sizeLabel = total > 0 ? `${formatBytes(transferred)} / ${formatBytes(total)}` : '';

  return (
    <div className="up-modal-screen">
      <div className="up-modal-card">
        <div className="up-modal-icon">
          <UpdateIcon />
        </div>
        <h1 className="up-modal-title">Atualizador</h1>
        <p className="up-modal-subtitle">
          É muito importante que mantenha o sistema sempre atualizado para garantir a segurança e o bom
          funcionamento.
        </p>

        <hr className="up-modal-divider" />

        <div className="up-modal-versions">
          <span className="up-modal-label">Versão atual:</span>
          <code className="up-modal-version">{info.currentVersion}</code>
          <span className="up-modal-arrow">→</span>
          <span className="up-modal-label">Nova versão:</span>
          <code className="up-modal-version">{targetVersion}</code>
        </div>

        <div
          className="up-modal-progress"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="up-modal-progress-fill" style={{ width: `${percent}%` }} />
          <span className="up-modal-progress-label">{ready ? '100%' : percentLabel}</span>
        </div>

        <p className="up-modal-foot">
          {ready
            ? 'O jDoc será reiniciado em instantes para concluir a atualização.'
            : 'O jDoc será reiniciado automaticamente ao concluir o download.'}
        </p>
        {sizeLabel && <p className="up-modal-foot-sub">{sizeLabel}</p>}
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<AppUpdateModal />);
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
.up-modal-screen {
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
.up-modal-card {
  width: 100%;
  max-width: 28rem;
  padding: 1.75rem;
  border: 1px solid var(--app-border);
  border-radius: 1rem;
  background: var(--app-card);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  text-align: center;
}
.up-modal-icon {
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
.up-modal-title {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: #fff;
}
.up-modal-subtitle {
  margin: 0 auto 1rem;
  max-width: 22rem;
  font-size: 0.78rem;
  color: var(--app-muted);
  line-height: 1.4;
}
.up-modal-divider {
  margin: 1rem 0 1rem;
  border: none;
  border-top: 1px solid var(--app-border);
}
.up-modal-versions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  margin-bottom: 1rem;
}
.up-modal-label { color: var(--app-muted); }
.up-modal-version {
  padding: 0.15rem 0.5rem;
  border-radius: 0.35rem;
  background: var(--app-input-bg);
  border: 1px solid var(--app-border);
  color: var(--app-text);
  font-size: 0.78rem;
}
.up-modal-arrow { color: var(--neon-violet); }
.up-modal-progress {
  position: relative;
  height: 1.5rem;
  border-radius: 9999px;
  overflow: hidden;
  border: 1px solid var(--app-input-border);
  background: var(--app-input-bg);
  margin: 0.5rem 0 0.85rem;
}
.up-modal-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--neon-purple), var(--neon-violet));
  transition: width 0.25s ease;
}
.up-modal-progress-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
.up-modal-foot {
  margin: 0;
  font-size: 0.72rem;
  color: var(--app-muted);
}
.up-modal-foot-sub {
  margin: 0.4rem 0 0;
  font-size: 0.7rem;
  color: var(--app-muted);
}
`;
document.head.appendChild(style);
