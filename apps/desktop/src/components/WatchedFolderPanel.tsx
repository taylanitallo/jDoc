import { useEffect, useState } from 'react';

/**
 * Painel de configuracao da pasta monitorada (Marco 9): escolher/parar o
 * monitoramento. A lista de arquivos pendentes detectados aparece integrada
 * na mesma lista do UploadView (ver mergeWatchedPending).
 */
export function WatchedFolderPanel() {
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = (await window.jdoc.invoke('watch:get-config')) as { folder: string | null };
      setFolder(res.folder);
      setLoaded(true);
    })();
  }, []);

  async function chooseFolder() {
    setBusy(true);
    try {
      const res = (await window.jdoc.invoke('watch:choose-folder')) as { folder: string | null };
      setFolder(res.folder);
    } finally {
      setBusy(false);
    }
  }

  async function stopWatching() {
    setBusy(true);
    try {
      await window.jdoc.invoke('watch:stop');
      setFolder(null);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="up-watch-panel">
      {folder ? (
        <>
          <span className="up-watch-label">
            📁 Pasta monitorada: <strong title={folder}>{folder}</strong>
          </span>
          <button type="button" className="up-btn" onClick={() => void stopWatching()} disabled={busy}>
            parar monitoramento
          </button>
        </>
      ) : (
        <>
          <span className="up-watch-label">Nenhuma pasta monitorada — novos PDFs entram automaticamente na lista abaixo.</span>
          <button type="button" className="up-btn" onClick={() => void chooseFolder()} disabled={busy}>
            escolher pasta
          </button>
        </>
      )}
    </div>
  );
}
