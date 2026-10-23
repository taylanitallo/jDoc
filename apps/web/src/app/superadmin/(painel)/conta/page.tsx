'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Check, Copy, Laptop, LogOut, ShieldCheck, ShieldOff, UserRound } from 'lucide-react';
import { PAPEL_ADMIN_DESCRICAO, PAPEL_ADMIN_LABEL, type AdminAtual, type AdminSessao, type UiTheme } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { TrocarSenha } from '@/components/conta/trocar-senha';
import { ThemePicker } from '@/components/theme/theme-picker';

export default function ContaSuperadminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useQuery({ queryKey: ['superadmin', 'me'], queryFn: () => api<AdminAtual>('/superadmin/me') });

  const salvarTema = async (tema: UiTheme | null) => {
    try {
      await api('/superadmin/auth/preferences', { method: 'PUT', body: { uiTheme: tema } });
      qc.setQueryData<AdminAtual>(['superadmin', 'me'], (a) => (a ? { ...a, uiTheme: tema } : a));
      toast.success('Aparência salva.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar a aparência.');
      throw e;
    }
  };

  if (!me) return <Skeleton rows={6} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Minha conta" description={me.email} />

      {me.mustChangePassword && (
        <TrocarSenha
          rota="/superadmin/auth/password"
          minimo={10}
          destaque
          onTrocada={() => qc.invalidateQueries({ queryKey: ['superadmin', 'me'] })}
        />
      )}

      <VerificacaoDuasEtapas me={me} />

      <Card>
        <CardHeader icon={UserRound} title="Dados" />
        <dl className="grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <dt className="label-caps">Nome</dt>
            <dd className="mt-1 text-sm font-semibold text-ink-900">{me.nome}</dd>
          </div>
          <div>
            <dt className="label-caps">E-mail</dt>
            <dd className="mt-1 text-sm text-ink-800">{me.email}</dd>
          </div>
          <div>
            <dt className="label-caps">Papel</dt>
            <dd className="mt-1">
              <Badge tone="brand">{PAPEL_ADMIN_LABEL[me.role]}</Badge>
              <p className="mt-1 text-xs text-ink-500">{PAPEL_ADMIN_DESCRICAO[me.role]}</p>
            </dd>
          </div>
        </dl>
      </Card>

      {!me.mustChangePassword && <TrocarSenha rota="/superadmin/auth/password" minimo={10} />}

      <SessoesAtivas />

      <ThemePicker escopo="superadmin" valor={me.uiTheme} corOrgao={null} rotuloOrgao="Usar o padrão" onSalvar={salvarTema} />
    </div>
  );
}

function VerificacaoDuasEtapas({ me }: { me: AdminAtual }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [segredo, setSegredo] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [desligar, setDesligar] = useState(false);

  useEffect(() => {
    if (me.mfaEnabled) return;
    let ativo = true;
    api<{ secret: string; otpauthUrl: string }>('/superadmin/auth/mfa/setup', { method: 'POST' })
      .then(async (r) => {
        if (!ativo) return;
        setSegredo(r.secret);
        setQr(await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 192 }));
      })
      .catch((e) => ativo && setErro(e instanceof ApiError ? e.message : 'Não foi possível gerar o QR code.'));
    return () => {
      ativo = false;
    };
  }, [me.mfaEnabled]);

  const ativar = useMutation({
    mutationFn: () => api('/superadmin/auth/mfa/enable', { method: 'POST', body: { totp: codigo } }),
    onSuccess: async () => {
      toast.success('Verificação em 2 etapas ativada.');
      setCodigo('');
      await qc.invalidateQueries({ queryKey: ['superadmin', 'me'] });
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Código inválido.'),
  });

  if (me.mfaEnabled) {
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
        <DesligarMfa aberto={desligar} onFechar={() => setDesligar(false)} />
      </Card>
    );
  }

  return (
    <Card className="ring-2 ring-warning-500/40">
      <CardHeader
        icon={ShieldCheck}
        title="Verificação em 2 etapas"
        description="Obrigatória para usar o painel. Escaneie o QR code no Google Authenticator, Microsoft Authenticator, Aegis ou similar e confirme o código."
      />
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

function DesligarMfa({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const desligar = useMutation({
    mutationFn: () => api('/superadmin/auth/mfa/disable', { method: 'POST', body: { senha, totp: codigo } }),
    onSuccess: async () => {
      toast.success('Verificação em 2 etapas desligada. Configure de novo para voltar a usar o painel.');
      onFechar();
      await qc.invalidateQueries({ queryKey: ['superadmin', 'me'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível desligar.'),
  });
  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      title="Desligar verificação em 2 etapas?"
      subtitle="Sem ela o painel fica bloqueado até você configurar um novo autenticador."
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

function SessoesAtivas() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: sessoes } = useQuery({
    queryKey: ['superadmin', 'sessoes'],
    queryFn: () => api<AdminSessao[]>('/superadmin/auth/sessions'),
  });
  const encerrar = useMutation({
    mutationFn: (id: string) => api(`/superadmin/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Sessão encerrada.');
      await qc.invalidateQueries({ queryKey: ['superadmin', 'sessoes'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível encerrar.'),
  });

  return (
    <Card>
      <CardHeader icon={Laptop} title="Sessões ativas" description="Navegadores conectados à sua conta. Sessões sem uso por 12 horas expiram sozinhas." />
      {!sessoes ? (
        <div className="p-5">
          <Skeleton rows={2} />
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {sessoes.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-ink-100 text-ink-600">
                <Laptop className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  {s.dispositivo}
                  {s.atual && <Badge tone="success">Esta sessão</Badge>}
                </p>
                <p className="text-xs text-ink-500">
                  {s.ip ?? 'IP desconhecido'} · último uso {fmtRelative(s.ultimoUso)}
                </p>
              </div>
              {!s.atual && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<LogOut aria-hidden />}
                  loading={encerrar.isPending && encerrar.variables === s.id}
                  onClick={() => encerrar.mutate(s.id)}
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
