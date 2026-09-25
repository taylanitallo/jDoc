'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Copy, Check } from 'lucide-react';
import QRCode from 'qrcode';
import { api, ApiError } from '@/lib/api';
import { cardCls, inputCls, labelCls, btnPrimary, btnGhost } from '@/components/ui';

/**
 * Configuracao de 2FA feita DE DENTRO do sistema (nao mais uma exigencia
 * pre-login): o superadmin loga so com email/senha na primeira vez e e
 * trazido pra ca pra escanear o QR e confirmar um codigo antes de habilitar.
 */
export default function TwoFaSetupPage() {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ secret: string; otpauthUrl: string }>('/superadmin/auth/2fa/setup', { method: 'POST' })
      .then(async (r) => {
        if (!active) return;
        setSecret(r.secret);
        setQrDataUrl(await QRCode.toDataURL(r.otpauthUrl));
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Falha ao gerar o 2FA.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      await api('/superadmin/auth/2fa/confirm', { method: 'POST', body: { totp: code } });
      router.push('/superadmin/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Código inválido.');
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-brand-600">
          <ShieldCheck className="h-7 w-7 text-white" aria-hidden />
        </div>
        <h1 className="mt-3 text-lg font-bold text-ink-800">Configurar 2FA</h1>
        <p className="text-xs text-ink-500">
          Escaneie o QR com o Google Authenticator, Aegis ou similar, e confirme o código gerado.
        </p>
      </div>

      <div className={`${cardCls} space-y-4 p-6`}>
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="QR code do 2FA" className="mx-auto h-48 w-48" />
        ) : (
          <p className="text-center text-sm text-ink-500">Gerando…</p>
        )}

        {secret && (
          <div>
            <label className={labelCls}>Ou digite manualmente</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-[10px] border border-ink-200 bg-surface px-3 py-2 text-xs text-ink-800">
                {secret}
              </code>
              <button
                type="button"
                onClick={() => void copySecret()}
                className={btnGhost}
                title="Copiar secret"
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="code" className={labelCls}>
            Código de 6 dígitos
          </label>
          <input
            id="code"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={`${inputCls} text-center text-lg tracking-[0.3em]`}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={busy || code.length !== 6}
          onClick={() => void confirm()}
          className={`${btnPrimary} w-full py-2.5 text-sm`}
        >
          {busy ? 'Confirmando…' : 'Confirmar e ativar 2FA'}
        </button>

        <button
          type="button"
          onClick={() => router.push('/superadmin/dashboard')}
          className="w-full text-center text-xs font-semibold text-ink-500 hover:text-ink-800"
        >
          Configurar depois
        </button>
      </div>
    </div>
  );
}
