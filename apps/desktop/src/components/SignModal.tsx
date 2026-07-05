import { useEffect, useState } from 'react';
import type { CertInfo, SigningStatus } from '../types';

/**
 * Modal de assinatura ICP-Brasil. Lista certificados do token, pede PIN e
 * assina o PDF antes do envio. Sem token → mensagem clara; o envio sem
 * assinatura continua possível (basta fechar).
 *
 * O teste com token real está PENDENTE (sem hardware). O status vem do main
 * com `pending: true`.
 */
export function SignModal({
  fileId,
  file,
  onSigned,
  onClose,
}: {
  fileId: string;
  file: File;
  onSigned: (fileId: string, signed: Uint8Array) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<SigningStatus | null>(null);
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const st = (await window.jdoc.invoke('signing:status')) as SigningStatus;
        if (alive) setStatus(st);
        if (st.available && st.tokenPresent) {
          const res = (await window.jdoc.invoke('signing:certificates')) as { certificates: CertInfo[] };
          if (alive) {
            setCerts(res.certificates);
            if (res.certificates[0]) setSelected(res.certificates[0].id);
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Falha ao consultar o token');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function doSign() {
    setBusy(true);
    setError(null);
    try {
      const content = new Uint8Array(await file.arrayBuffer());
      const res = (await window.jdoc.invoke('signing:sign', {
        fileId,
        certId: selected,
        pin,
        content,
      })) as { content: Uint8Array };
      onSigned(fileId, res.content);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao assinar');
    } finally {
      setPin(''); // PIN não permanece na UI
      setBusy(false);
    }
  }

  const ready = status?.available && status?.tokenPresent && certs.length > 0;

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true">
      <div className="sign-modal">
        <header className="viewer-bar">
          <span className="viewer-title">Assinar antes de enviar</span>
          <span className="viewer-spacer" />
          <button type="button" className="up-btn" onClick={onClose}>
            Fechar
          </button>
        </header>

        <div className="sign-body">
          {loading && <p className="viewer-msg">Consultando token…</p>}

          {!loading && status && (
            <p className="sign-status">
              {status.message}
              {status.pending ? ' (teste com hardware pendente)' : ''}
            </p>
          )}

          {!loading && !ready && (
            <p className="sign-hint">
              Sem token/certificado disponível. Você pode <strong>enviar sem assinatura</strong>{' '}
              fechando este modal.
            </p>
          )}

          {ready && (
            <>
              <label className="up-field">
                <span>Certificado</span>
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  {certs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.subject} — val. {c.notAfter.slice(0, 10)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="up-field">
                <span>PIN do token</span>
                <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
              </label>

              <button type="button" className="up-send" disabled={busy || !pin || !selected} onClick={() => void doSign()}>
                {busy ? 'Assinando…' : 'Assinar'}
              </button>
            </>
          )}

          {error && <p className="up-row-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
