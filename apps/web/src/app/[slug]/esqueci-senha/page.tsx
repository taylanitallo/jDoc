'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, KeyRound, MailCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { removerTemaMarca } from '@/lib/brand-theme';
import { AuthLayout } from '@/components/shell/auth-layout';
import { Button, Card, Field, Input } from '@/components/ui';
import { NovaSenhaForm } from '@/components/conta/nova-senha-form';

type Etapa = 'pedir' | 'codigo' | 'pronto';
const ESPERA_REENVIO_S = 60;

/**
 * Esqueci a senha: CPF ou e-mail -> e-mail com link e codigo. Daqui mesmo da
 * para digitar o codigo e criar a nova senha (util no jDoc Desktop, que nao
 * abre o link do e-mail na mesma janela).
 */
export default function EsqueciSenhaPage() {
  const { slug } = useParams<{ slug: string }>();
  const [etapa, setEtapa] = useState<Etapa>('pedir');
  const [identificador, setIdentificador] = useState('');
  const [codigo, setCodigo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [espera, setEspera] = useState(0);

  useEffect(() => removerTemaMarca(), []);
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const pedir = async (e?: FormEvent) => {
    e?.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await api<{ mensagem: string }>(`/t/${slug}/auth/esqueci-senha`, { method: 'POST', body: { identificador: identificador.trim() } });
      setMensagem(r.mensagem);
      setEtapa('codigo');
      setEspera(ESPERA_REENVIO_S);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível enviar agora. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  const redefinir = async (novaSenha: string) => {
    setErro(null);
    setEnviando(true);
    try {
      await api(`/t/${slug}/auth/redefinir-senha`, { method: 'POST', body: { identificador: identificador.trim(), codigo, novaSenha } });
      setEtapa('pronto');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível criar a nova senha.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-600/15">
          {etapa === 'pronto' ? <CheckCircle2 className="h-6 w-6" aria-hidden /> : etapa === 'codigo' ? <MailCheck className="h-6 w-6" aria-hidden /> : <KeyRound className="h-6 w-6" aria-hidden />}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-2xl">
            {etapa === 'pronto' ? 'Senha criada' : 'Esqueci minha senha'}
          </h1>
          <p className="text-sm text-ink-500">
            {etapa === 'pedir' && 'Informe o CPF ou o e-mail cadastrado.'}
            {etapa === 'codigo' && 'Use o link do e-mail ou digite o código aqui.'}
            {etapa === 'pronto' && 'Já pode entrar com a nova senha.'}
          </p>
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        {etapa === 'pedir' && (
          <form onSubmit={pedir} className="space-y-4" noValidate>
            <Field label="CPF ou e-mail" htmlFor="ident" required error={erro ?? undefined}>
              <Input id="ident" autoComplete="username" value={identificador} onChange={(e) => setIdentificador(e.target.value)} placeholder="000.000.000-00 ou seu@email.gov.br" autoFocus />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={enviando} disabled={identificador.trim().length < 3}>
              Enviar
            </Button>
          </form>
        )}

        {etapa === 'codigo' && (
          <>
            <p className="mb-4 rounded-[10px] bg-info-50 px-3 py-2.5 text-sm text-ink-700 ring-1 ring-inset ring-info-500/20">{mensagem}</p>
            <NovaSenhaForm
              enviando={enviando}
              erro={erro}
              onEnviar={redefinir}
              antes={
                <Field label="Código recebido" htmlFor="codigo" required hint="6 dígitos, vale por 15 minutos.">
                  <Input
                    id="codigo"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="text-center text-lg tracking-[0.3em]"
                  />
                </Field>
              }
            />
            <button
              type="button"
              disabled={espera > 0 || enviando}
              onClick={() => void pedir()}
              className="mt-3 w-full text-center text-[13px] font-semibold text-brand-600 disabled:text-ink-400"
            >
              {espera > 0 ? `Reenviar em ${espera} s` : 'Reenviar e-mail'}
            </button>
          </>
        )}

        {etapa === 'pronto' && (
          <Link href={`/${slug}/login`} className="flex h-12 w-full items-center justify-center rounded-[12px] bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700">
            Ir para o login
          </Link>
        )}
      </Card>

      {etapa !== 'pronto' && (
        <div className="mt-4 text-center text-sm">
          <Link href={`/${slug}/login`} className="inline-flex items-center gap-1 font-medium text-ink-500 hover:text-ink-800">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Voltar ao login
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
