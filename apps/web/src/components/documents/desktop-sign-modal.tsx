'use client';

import { useEffect, useState } from 'react';
import { Modal, btnGhost, btnPrimary, inputCls, labelCls } from '@/components/ui';
import { desktopInvoke } from '@/lib/desktop-bridge';

/**
 * Assinatura ICP-Brasil antes do envio — so existe dentro do jDoc Desktop
 * (usa `window.jdoc.invoke('signing:*')`, que fala com o token PKCS#11 via
 * processo main do Electron; um navegador comum nao tem acesso a isso).
 * Porta a mesma logica do SignModal do app desktop para o site, reaproveitada
 * quando o site roda embutido no executavel.
 */

interface CertInfo {
  id: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
}

interface SigningStatus {
  available: boolean;
  tokenPresent: boolean;
  pending: boolean;
  message: string;
}

export function DesktopSignModal({
  fileId,
  file,
  onSigned,
  onClose,
}: {
  fileId: string;
  file: File;
  onSigned: (signed: Uint8Array) => void;
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
        const st = await desktopInvoke<SigningStatus>('signing:status');
        if (alive) setStatus(st);
        if (st?.available && st.tokenPresent) {
          const res = await desktopInvoke<{ certificates: CertInfo[] }>('signing:certificates');
          if (alive) {
            setCerts(res?.certificates ?? []);
            if (res?.certificates[0]) setSelected(res.certificates[0].id);
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
      const res = await desktopInvoke<{ content: Uint8Array }>('signing:sign', {
        fileId,
        certId: selected,
        pin,
        content,
      });
      if (!res) throw new Error('Assinatura indisponível.');
      onSigned(res.content);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao assinar');
    } finally {
      setPin(''); // PIN nao permanece na UI
      setBusy(false);
    }
  }

  const ready = status?.available && status?.tokenPresent && certs.length > 0;

  return (
    <Modal title="Assinar antes de enviar" subtitle={file.name} open onClose={onClose}>
      <div className="space-y-4">
        {loading && <p className="text-sm text-app-muted">Consultando token…</p>}

        {!loading && status && (
          <p className="text-sm text-app-muted">
            {status.message}
            {status.pending ? ' (teste com hardware pendente)' : ''}
          </p>
        )}

        {!loading && !ready && (
          <p className="text-sm text-app-muted">
            Sem token/certificado disponível. Você pode <strong>enviar sem assinatura</strong>{' '}
            fechando este modal.
          </p>
        )}

        {ready && (
          <>
            <div>
              <label className={labelCls}>Certificado</label>
              <select className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)}>
                {certs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.subject} — val. {c.notAfter.slice(0, 10)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>PIN do token</label>
              <input
                type="password"
                className={inputCls}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
              />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-app-error-text">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancelar
          </button>
          {ready && (
            <button type="button" className={btnPrimary} disabled={busy || !pin || !selected} onClick={() => void doSign()}>
              {busy ? 'Assinando…' : 'Assinar'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
