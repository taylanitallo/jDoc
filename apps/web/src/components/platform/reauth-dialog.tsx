'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError, setReauthHandler } from '@/lib/api';
import { Button, Field, Input, Modal } from '@/components/ui';

/**
 * Acoes criticas do superadmin (excluir orgao, restaurar, "entrar como",
 * chaves de API, papel/senha/2FA da equipe): quando a API responde
 * `reauth_required`, o client chama este modal; confirmada a identidade, a
 * acao original e repetida sozinha. Montado uma vez no layout do painel.
 */
export function ReauthDialog() {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const pendente = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    setReauthHandler(() => {
      // Varias acoes ao mesmo tempo dividem o mesmo modal.
      if (pendente.current) return pendente.current;
      pendente.current = new Promise<boolean>((ok) => {
        resolver.current = ok;
        setSenha('');
        setCodigo('');
        setErro(null);
        setAberto(true);
      }).finally(() => {
        pendente.current = null;
      });
      return pendente.current;
    });
    return () => setReauthHandler(null);
  }, []);

  const fechar = (ok: boolean) => {
    setAberto(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const confirmar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api('/superadmin/auth/reauth', { method: 'POST', body: { senha, totp: codigo } });
      fechar(true);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível confirmar.');
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      open={aberto}
      onClose={() => fechar(false)}
      title="Confirme sua identidade"
      subtitle="Esta ação é crítica. Confirme com sua senha e o código do autenticador (vale por 5 minutos)."
      size="sm"
    >
      <form onSubmit={confirmar} className="space-y-4" noValidate>
        <Field label="Senha" htmlFor="reauth-senha" required>
          <Input id="reauth-senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
        </Field>
        <Field label="Código do autenticador" htmlFor="reauth-codigo" required error={erro ?? undefined}>
          <Input
            id="reauth-codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="tracking-[0.3em]"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => fechar(false)}>
            Cancelar
          </Button>
          <Button type="submit" loading={enviando} disabled={!senha || codigo.length !== 6} leftIcon={<ShieldCheck aria-hidden />}>
            Confirmar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
