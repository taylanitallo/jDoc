import { useEffect, useState } from 'react';

/**
 * Visualizador de PDF. Pede a signed URL (60s) ao main e aponta um <iframe>
 * direto para ela — sem baixar para disco. A navegacao do iframe para fora e
 * bloqueada no main (will-frame-navigate + setWindowOpenHandler).
 * Se a URL expirar (403), "Recarregar" pede outra.
 */
export function PdfViewer({
  documentId,
  title,
  onClose,
}: {
  documentId: string;
  title: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setUrl(null);
    void (async () => {
      try {
        const res = (await window.jdoc.invoke('documents:view', { id: documentId })) as { url: string };
        if (alive) setUrl(res.url);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Falha ao abrir documento');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [documentId, nonce]);

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true">
      <div className="viewer">
        <header className="viewer-bar">
          <span className="viewer-title" title={title}>
            {title}
          </span>
          <span className="viewer-spacer" />
          <button type="button" className="up-btn" onClick={() => setNonce((n) => n + 1)}>
            Recarregar
          </button>
          <button type="button" className="up-btn" onClick={onClose}>
            Fechar
          </button>
        </header>

        {loading && <p className="viewer-msg">Abrindo…</p>}
        {error && (
          <p className="viewer-msg viewer-error">
            {error}{' '}
            <button type="button" className="up-btn" onClick={() => setNonce((n) => n + 1)}>
              Tentar de novo
            </button>
          </p>
        )}
        {url && !error && (
          <iframe className="viewer-frame" title={title} src={url} referrerPolicy="no-referrer" />
        )}
      </div>
    </div>
  );
}
