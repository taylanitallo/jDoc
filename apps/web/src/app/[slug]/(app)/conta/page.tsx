'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import type { UiTheme, UsuarioAtual } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtCpf } from '@/lib/format';
import { Button, Card, CardHeader, Field, Input, PageHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { TrocarSenha } from '@/components/conta/trocar-senha';
import { VerificacaoDuasEtapas } from '@/components/conta/duas-etapas';
import { ThemePicker } from '@/components/theme/theme-picker';

export default function MinhaContaPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['auth', 'me', slug];
  const { data: usuario } = useQuery({ queryKey: chave, queryFn: () => api<UsuarioAtual>(`/t/${slug}/auth/me`) });

  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  useEffect(() => {
    if (!usuario) return;
    setNome(usuario.nome);
    setCpf(fmtCpf(usuario.cpf));
  }, [usuario]);

  const salvarDados = useMutation({
    mutationFn: () =>
      api<UsuarioAtual>(`/t/${slug}/auth/conta`, {
        method: 'PUT',
        body: { nome: nome.trim(), cpf: cpf.replace(/\D/g, '') || null },
      }),
    onSuccess: (u) => {
      qc.setQueryData(chave, u);
      toast.success('Dados atualizados.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });

  const salvarTema = async (tema: UiTheme | null) => {
    try {
      await api(`/t/${slug}/auth/preferences`, { method: 'PUT', body: { uiTheme: tema } });
      qc.setQueryData<UsuarioAtual>(chave, (u) => (u ? { ...u, uiTheme: tema } : u));
      toast.success('Aparência salva.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar a aparência.');
      throw e;
    }
  };

  if (!usuario) return <Skeleton rows={6} />;

  const enviarDados = (e: FormEvent) => {
    e.preventDefault();
    salvarDados.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Minha conta" description={`${usuario.email} · ${usuario.orgao}`} />

      {usuario.mustChangePassword && (
        <TrocarSenha
          rota={`/t/${slug}/auth/password`}
          minimo={6}
          destaque
          onTrocada={async () => {
            await qc.invalidateQueries({ queryKey: chave });
            router.replace(`/${slug}/modulos`);
          }}
        />
      )}

      {/* "Entrar como": a equipe JEOS nao mexe no autenticador de ninguem. */}
      {!usuario.impersonacao && !usuario.mustChangePassword && (
        <VerificacaoDuasEtapas
          rotaBase={`/t/${slug}/auth/mfa`}
          ativo={usuario.mfaEnabled}
          destaque={usuario.mfaPendente}
          descricaoPendente={
            usuario.mfaPendente
              ? 'O órgão exige verificação em 2 etapas para administradores. Escaneie o QR code no Google Authenticator, Microsoft Authenticator ou similar e confirme o código para liberar o sistema.'
              : 'Recomendada. Além da senha, cada acesso pede um código do aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar).'
          }
          avisoDesligar={
            usuario.mfaPendente || usuario.role === 'admin'
              ? 'Se o órgão exige 2 etapas para administradores, o sistema fica bloqueado até você configurar de novo.'
              : 'Sua conta volta a pedir só a senha.'
          }
          onMudou={() => qc.invalidateQueries({ queryKey: chave })}
        />
      )}

      <Card>
        <CardHeader icon={UserRound} title="Dados pessoais" description="O CPF também serve para recuperar a senha." />
        <form onSubmit={enviarDados} className="grid gap-4 p-5 sm:grid-cols-3" noValidate>
          <Field label="Nome" htmlFor="conta-nome" required>
            <Input id="conta-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="E-mail" htmlFor="conta-email" hint="Para trocar o e-mail, fale com o administrador do órgão.">
            <Input id="conta-email" value={usuario.email} disabled />
          </Field>
          <Field label="CPF" htmlFor="conta-cpf">
            <Input
              id="conta-cpf"
              value={cpf}
              onChange={(e) => setCpf(fmtCpf(e.target.value))}
              inputMode="numeric"
              placeholder="000.000.000-00"
            />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" loading={salvarDados.isPending} disabled={nome.trim().length < 2}>
              Salvar dados
            </Button>
          </div>
        </form>
      </Card>

      {!usuario.mustChangePassword && <TrocarSenha rota={`/t/${slug}/auth/password`} minimo={6} />}

      <ThemePicker escopo={slug} valor={usuario.uiTheme} corOrgao={usuario.corOrgao} onSalvar={salvarTema} />
    </div>
  );
}
