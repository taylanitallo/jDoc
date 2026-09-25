'use client';

import { useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck, CircleX, FileSearch, Loader2, ShieldCheck, Upload } from 'lucide-react';
import {
  CODIGO_REGEX,
  formatarCodigo,
  normalizarCodigo,
  type ConferenciaHashPublica,
  type VerificacaoPublica,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button, inputClasses, labelClasses } from '@/components/ui';

/** Moldura publica: tela clara do Design System, sem login. */
export function MolduraPublica({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-ink-200/70 bg-surface">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4 sm:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600 text-white">
            <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-bold text-ink-900">Verificação de autenticidade</p>
            <p className="text-xs text-ink-500">jDoc — Gestão eletrônica de documentos</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="animate-slide-up rounded-[16px] border border-ink-200/70 bg-surface p-5 shadow-xs sm:p-6">{children}</div>
        <p className="mt-6 text-center text-xs text-ink-500">© 2026 JEOS Sistemas e Assessorias Ltda</p>
      </main>
    </div>
  );
}

export function FormCodigo({ inicial = '' }: { inicial?: string }) {
  const router = useRouter();
  const [valor, setValor] = useState(inicial);
  const codigo = normalizarCodigo(valor);
  const valido = CODIGO_REGEX.test(codigo);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (valido) router.push(`/verificar/${codigo}`);
  };
  return (
    <form onSubmit={enviar} className="space-y-3">
      <label htmlFor="codigo" className={labelClasses}>
        Código de verificação (impresso no rodapé do documento)
      </label>
      <input
        id="codigo"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoComplete="off"
        className={cn(inputClasses, 'h-12 text-center font-mono text-lg tracking-widest sm:text-lg')}
      />
      <Button type="submit" size="lg" disabled={!valido} className="w-full" leftIcon={<ShieldCheck aria-hidden />}>
        Verificar
      </Button>
    </form>
  );
}

const SITUACAO = {
  vigente: {
    icon: CircleCheck,
    cor: 'bg-success-50 text-success-600 ring-success-600/20',
    titulo: 'Documento autêntico',
    texto: 'Este código corresponde a um documento arquivado e vigente no sistema do órgão.',
  },
  substituido: {
    icon: CircleAlert,
    cor: 'bg-warning-50 text-warning-600 ring-warning-600/20',
    titulo: 'Documento substituído',
    texto: 'O documento existe, mas o arquivo desta cópia foi substituído por uma versão mais recente no órgão.',
  },
  excluido: {
    icon: CircleX,
    cor: 'bg-danger-50 text-danger-600 ring-danger-600/20',
    titulo: 'Documento excluído',
    texto: 'O código existe, mas o documento foi excluído do acervo do órgão.',
  },
  eliminado: {
    icon: CircleX,
    cor: 'bg-danger-50 text-danger-600 ring-danger-600/20',
    titulo: 'Documento eliminado',
    texto: 'O documento cumpriu o prazo de guarda e foi eliminado conforme a Tabela de Temporalidade do órgão.',
  },
} as const;

async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const fmtData = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—');

export function ResultadoVerificacao({ codigo }: { codigo: string }) {
  const [dados, setDados] = useState<VerificacaoPublica | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<(ConferenciaHashPublica & { arquivo: string }) | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  useEffect(() => {
    setDados(null);
    setErro(null);
    api<VerificacaoPublica>(`/public/verificar/${encodeURIComponent(codigo)}`)
      .then(setDados)
      .catch((e) =>
        setErro(
          e instanceof ApiError && e.status === 404
            ? 'Código não encontrado. Confira os caracteres digitados.'
            : e instanceof ApiError && e.status === 429
              ? 'Muitas consultas seguidas. Aguarde um minuto e tente de novo.'
              : 'Não foi possível verificar agora. Tente novamente.',
        ),
      );
  }, [codigo]);

  const conferir = async (file: File | undefined) => {
    if (!file) return;
    setConferindo(true);
    setConferencia(null);
    try {
      // So o hash sai do navegador — o arquivo nunca e enviado.
      const hash = await sha256(file);
      const r = await api<ConferenciaHashPublica>(`/public/verificar/${encodeURIComponent(codigo)}/conferir`, {
        method: 'POST',
        body: { sha256: hash },
      });
      setConferencia({ ...r, arquivo: file.name });
    } catch {
      setErro('Falha ao conferir o arquivo.');
    } finally {
      setConferindo(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    void conferir(e.dataTransfer.files?.[0]);
  };

  if (erro) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2.5 text-sm text-danger-600 ring-1 ring-inset ring-danger-600/15">{erro}</p>
        <FormCodigo inicial={formatarCodigo(codigo)} />
      </div>
    );
  }
  if (!dados) return <div className="h-40 animate-pulse rounded-[16px] bg-ink-100" />;

  const s = SITUACAO[dados.situacao];
  const por = dados.assinatura.assinadoPor ? ` — ${dados.assinatura.assinadoPor}` : '';
  const assinaturaTexto =
    {
      valida: `Válida (ICP-Brasil)${por}`,
      invalida: `Inválida ou revogada${por}`,
      nao_verificada: `Assinado, validação da cadeia pendente${por}`,
    }[dados.assinatura.status] ?? 'Não assinado digitalmente';
  return (
    <div className="space-y-5">
      <div className={`flex items-start gap-3 rounded-[12px] p-4 ring-1 ring-inset ${s.cor}`}>
        <s.icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
        <div>
          <p className="font-bold">{s.titulo}</p>
          <p className="text-sm text-ink-700">{s.texto}</p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Item rotulo="Código">
          <span className="font-mono">{formatarCodigo(dados.codigo)}</span>
        </Item>
        <Item rotulo="Órgão">
          {dados.orgao.nome}
          {dados.orgao.cidade && <span className="text-ink-500"> — {dados.orgao.cidade}/{dados.orgao.uf}</span>}
        </Item>
        <Item rotulo="Tipo documental">{dados.tipoDocumental}</Item>
        <Item rotulo="Data do documento">{fmtData(dados.dataDocumento)}</Item>
        <Item rotulo="Arquivado em">{fmtData(dados.arquivadoEm)}</Item>
        <Item rotulo="Assinatura digital">
          {assinaturaTexto}
        </Item>
        <div className="sm:col-span-2">
          <Item rotulo="SHA-256 do arquivo original">
            <span className="break-all font-mono text-xs">{dados.hashOriginal}</span>
          </Item>
        </div>
      </dl>

      <div
        role="button"
        tabIndex={0}
        aria-label="Conferir arquivo"
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById('arquivo-conferir')?.click()}
        onKeyDown={(e) => e.key === 'Enter' && document.getElementById('arquivo-conferir')?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-[16px] border-2 border-dashed p-5 text-center transition ${
          arrastando ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-brand-500 hover:bg-ink-50'
        }`}
      >
        {conferindo ? <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden /> : <Upload className="h-6 w-6 text-ink-400" aria-hidden />}
        <p className="text-sm font-semibold text-ink-900">Confira seu arquivo</p>
        <p className="text-xs text-ink-500">
          Arraste o PDF que você recebeu (a cópia autenticada ou o original). O arquivo não é enviado: só a impressão digital
          (SHA-256), calculada aqui no seu navegador.
        </p>
        <input id="arquivo-conferir" type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void conferir(e.target.files?.[0])} />
      </div>

      {conferencia && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-[12px] p-4 text-sm ring-1 ring-inset ${
            conferencia.resultado === 'nao_confere' ? SITUACAO.excluido.cor : SITUACAO.vigente.cor
          }`}
        >
          {conferencia.resultado === 'nao_confere' ? <CircleX className="h-5 w-5 shrink-0" aria-hidden /> : <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />}
          <p className="text-ink-700">
            <strong className="block text-ink-900">{conferencia.arquivo}</strong>
            {conferencia.resultado === 'original' && 'Idêntico ao arquivo original guardado pelo órgão.'}
            {conferencia.resultado === 'copia' && `Cópia autenticada emitida pelo sistema em ${fmtData(conferencia.emitidaEm)}, sem nenhuma alteração.`}
            {conferencia.resultado === 'nao_confere' &&
              'NÃO confere: este arquivo não é o original nem uma cópia emitida pelo sistema para este código. Pode ter sido alterado.'}
          </p>
        </div>
      )}

      <p className="text-center text-sm text-ink-500">
        <FileSearch className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        <Link href="/verificar" className="font-medium text-brand-600 hover:underline">Verificar outro código</Link>
      </p>
    </div>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-ink-200/70 bg-ink-50/60 px-3 py-2">
      <dt className="label-caps">{rotulo}</dt>
      <dd className="mt-0.5 text-ink-900">{children}</dd>
    </div>
  );
}
