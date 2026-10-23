'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Check, Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, CardHeader, Field, Input, Modal } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';

/**
 * Verificacao em 2 etapas (aplicativo autenticador), igual no painel da
 * plataforma e na Minha conta do orgao. `rotaBase` aponta para
 * `<...>/auth/mfa`, que responde setup, enable e disable.
 */
export function VerificacaoDuasEtapas({
  rotaBase,
  ativo,
  descricaoPendente,
  avisoDesligar,
  destaque = false,
  onMudou,
}: {
  rotaBase: string;
  ativo: boolean;
  /** Texto do cartao enquanto nao esta ligada (obrigatoria ou recomendada). */
  descricaoPendente: string;
  avisoDesligar: string;
  /** Moldura de alerta (quando e obrigatoria e falta configurar). */
  destaque?: boolean;
  onMudou: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [segredo, setSegredo] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [desligar, setDesligar] = useState(false);

  useEffect(() => {
    if (ativo) return;
    let vivo = true;
    api<{ secret: string; otpauthUrl: string }>(`${rotaBase}/setup`, { method: 'POST' })
      .then(async (r) => {
        if (!vivo) return;
        setSegredo(r.secret);
        setQr(await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 192 }));
      })
      .catch((e) => vivo && setErro(e instanceof ApiError ? e.message : 'Não foi possível gerar o QR code.'));
    return () => {
      vivo = false;
    };
  }, [ativo, rotaBase]);

  const ativar = useMutation({
    mutationFn: () => api(`${rotaBase}/enable`, { method: 'POST', body: { totp: codigo } }),
    onSuccess: async () => {
      toast.success('Verificação em 2 etapas ativada.');
      setCodigo('');
      await onMudou();
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Código inválido.'),
  });

  if (ativo) {
    return (
      <Card>
        <CardHeader
          icon={ShieldCheck}
          title="Verificação em 2 etapas"
          description="Ativa. Todo acesso pede o código do aplicativo autenticador."
          action={
            <Button size="sm" variant="outline" leftIcon={<ShieldOff aria-hidden />} onClick={() => setDesligar(true)}>
              Desligar
            </Button>
          }
        />
        <DesligarMfa rotaBase={rotaBase} aviso={avisoDesligar} aberto={desligar} onFechar={() => setDesligar(false)} onMudou={onMudou} />
      </Card>
    );
  }

  return (
    <Card className={destaque ? 'ring-2 ring-warning-500/40' : undefined}>
      <CardHeader icon={ShieldCheck} title="Verificação em 2 etapas" description={descricaoPendente} />
      <div className="grid gap-6 p-5 sm:grid-cols-[192px_1fr]">
        {/* Fundo branco de proposito: o QR precisa de contraste para ser lido, inclusive no tema escuro. */}
        <div className="flex h-48 w-48 items-center justify-center rounded-[12px] border border-ink-200 bg-white p-2">
          {qr ? <img src={qr} alt="QR code para o aplicativo autenticador" className="h-full w-full" /> : <Skeleton className="h-full w-full" />}
        </div>
        <div className="space-y-4">
          {segredo && (
            <Field label="Ou digite a chave no aplicativo" htmlFor="mfa-segredo">
              <div className="flex gap-2">
                <Input id="mfa-segredo" readOnly value={segredo} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copiar chave"
                  onClick={async () => {
                    await navigator.clipboard.writeText(segredo);
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 1500);
                  }}
                >
                  {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
            </Field>
          )}
          <Field label="Código de 6 dígitos" htmlFor="mfa-codigo" error={erro ?? undefined}>
            <Input
              id="mfa-codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="max-w-40 tracking-[0.3em]"
            />
          </Field>
          <Button onClick={() => ativar.mutate()} loading={ativar.isPending} disabled={codigo.length !== 6}>
            Confirmar e ativar
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DesligarMfa({
  rotaBase,
  aviso,
  aberto,
  onFechar,
  onMudou,
}: {
  rotaBase: string;
  aviso: string;
  aberto: boolean;
  onFechar: () => void;
  onMudou: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const desligar = useMutation({
    mutationFn: () => api(`${rotaBase}/disable`, { method: 'POST', body: { senha, totp: codigo } }),
    onSuccess: async () => {
      toast.success('Verificação em 2 etapas desligada.');
      onFechar();
      await onMudou();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível desligar.'),
  });
  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      title="Desligar verificação em 2 etapas?"
      subtitle={aviso}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button variant="danger" loading={desligar.isPending} disabled={!senha || codigo.length !== 6} onClick={() => desligar.mutate()}>
            Desligar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Senha" htmlFor="off-senha" required>
          <Input id="off-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Field>
        <Field label="Código do autenticador" htmlFor="off-codigo" required>
          <Input
            id="off-codigo"
            inputMode="numeric"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </Field>
      </div>
    </Modal>
  );
}
