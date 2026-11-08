'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { PAPEL_ADMIN_DESCRICAO, PAPEL_ADMIN_LABEL, type AdminAtual, type UiTheme } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { TrocarSenha } from '@/components/conta/trocar-senha';
import { VerificacaoDuasEtapas } from '@/components/conta/duas-etapas';
import { useRolarAoHash } from '@/components/conta/use-rolar-ao-hash';
import { SessoesAtivas } from '@/components/conta/sessoes-ativas';
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

  useRolarAoHash(!!me);

  if (!me) return <Skeleton rows={6} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Minha conta" description={me.email} />

      <VerificacaoDuasEtapas
        rotaBase="/superadmin/auth/mfa"
        ativo={me.mfaEnabled}
        destaque
        descricaoPendente="Obrigatória para usar o painel. Escaneie o QR code no Google Authenticator, Microsoft Authenticator, Aegis ou similar e confirme o código."
        avisoDesligar="Sem ela o painel fica bloqueado até você configurar um novo autenticador."
        onMudou={() => qc.invalidateQueries({ queryKey: ['superadmin', 'me'] })}
      />

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

      <TrocarSenha rota="/superadmin/auth/password" minimo={10} />

      <SessoesAtivas rota="/superadmin/auth/sessions" descricao="Navegadores conectados à sua conta. Sessões sem uso por 12 horas expiram sozinhas." />

      <ThemePicker escopo="superadmin" valor={me.uiTheme} corOrgao={null} rotuloOrgao="Usar o padrão" onSalvar={salvarTema} />
    </div>
  );
}
