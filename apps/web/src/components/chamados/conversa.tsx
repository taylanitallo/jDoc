'use client';

import { useRef, useState } from 'react';
import { EyeOff, FileText, Loader2, Paperclip, Send, X } from 'lucide-react';
import {
  CRITICIDADE_LABEL,
  STATUS_CHAMADO_LABEL,
  type AnexoChamado,
  type ChamadoResumo,
  type Criticidade,
  type MensagemChamado,
  type StatusChamado,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { enviarArquivo } from '@/lib/upload';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Avatar, Badge, Button, Textarea, type Tone } from '@/components/ui';
import { useToast } from '@/components/toast';
import { formatBytes } from '@/components/ui';

export const TOM_RELEASE: Record<'evolutiva' | 'corretiva' | 'seguranca' | 'manutencao', Tone> = {
  evolutiva: 'brand',
  corretiva: 'info',
  seguranca: 'danger',
  manutencao: 'neutral',
};

export const TOM_CRITICIDADE: Record<Criticidade, Tone> = { critica: 'danger', alta: 'orange', media: 'warning', baixa: 'neutral' };
export const TOM_STATUS_CHAMADO: Record<StatusChamado, Tone> = {
  aberto: 'info',
  em_atendimento: 'brand',
  aguardando_cliente: 'warning',
  resolvido: 'success',
  fechado: 'neutral',
  cancelado: 'neutral',
};

export function BadgesChamado({ c }: { c: Pick<ChamadoResumo, 'status' | 'criticidade' | 'respostaAtrasada' | 'solucaoAtrasada'> }) {
  const encerrado = ['resolvido', 'fechado', 'cancelado'].includes(c.status);
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={TOM_STATUS_CHAMADO[c.status]}>{STATUS_CHAMADO_LABEL[c.status]}</Badge>
      <Badge tone={TOM_CRITICIDADE[c.criticidade]}>{CRITICIDADE_LABEL[c.criticidade]}</Badge>
      {!encerrado && (c.respostaAtrasada || c.solucaoAtrasada) && <Badge tone="danger">Atrasado</Badge>}
    </span>
  );
}

/** Lista de anexos com link temporario. */
export function Anexos({ anexos, urlDe }: { anexos: AnexoChamado[]; urlDe: (key: string) => string }) {
  const toast = useToast();
  if (!anexos.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {anexos.map((a) => (
        <li key={a.key}>
          <button
            type="button"
            onClick={async () => {
              try {
                const { url } = await api<{ url: string }>(urlDe(a.key));
                window.open(url, '_blank', 'noopener');
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Não foi possível abrir o anexo.');
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-brand-500"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {a.nome} <span className="text-ink-400">({formatBytes(a.tamanho)})</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Conversa do chamado (as internas so aparecem para a equipe, com destaque). */
export function Conversa({ mensagens, urlAnexo, perspectiva }: { mensagens: MensagemChamado[]; urlAnexo: (key: string) => string; perspectiva: 'equipe' | 'orgao' }) {
  if (!mensagens.length) return <p className="text-sm text-ink-500">Ainda sem mensagens.</p>;
  return (
    <ol className="space-y-4">
      {mensagens.map((m) => {
        const minha = perspectiva === 'equipe' ? m.autorTipo === 'admin' : m.autorTipo === 'user';
        if (m.autorTipo === 'system') {
          return (
            <li key={m.id} className="text-center text-xs text-ink-500">
              {m.corpo} · {fmtDateTime(m.criadoEm)}
            </li>
          );
        }
        return (
          <li key={m.id} className={cn('flex gap-3', minha && 'flex-row-reverse')}>
            <Avatar nome={m.autor} size="sm" tone={m.autorTipo === 'admin' ? 'brand' : 'neutral'} />
            <div
              className={cn(
                'max-w-[85%] rounded-[12px] px-3.5 py-2.5 text-sm',
                m.interna ? 'border border-dashed border-warning-500/50 bg-warning-50' : minha ? 'bg-brand-50' : 'bg-ink-50',
              )}
            >
              <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                <strong className="text-ink-800">{m.autor}</strong>
                {m.autorTipo === 'admin' && perspectiva === 'orgao' && <span>Equipe JEOS</span>}
                {m.interna && (
                  <span className="inline-flex items-center gap-1 font-semibold text-warning-600">
                    <EyeOff className="h-3 w-3" aria-hidden /> Interna
                  </span>
                )}
                <span>{fmtDateTime(m.criadoEm)}</span>
              </p>
              <p className="whitespace-pre-wrap break-words text-ink-800">{m.corpo}</p>
              <Anexos anexos={m.anexos} urlDe={urlAnexo} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Caixa de resposta com anexos (PDF/PNG/JPG). `podeInterna` so para a equipe. */
export function Responder({
  rotaAnexo,
  podeInterna,
  onEnviar,
  desabilitado,
}: {
  rotaAnexo: string;
  podeInterna?: boolean;
  onEnviar: (m: { corpo: string; interna: boolean; anexos: AnexoChamado[] }) => Promise<void>;
  desabilitado?: boolean;
}) {
  const toast = useToast();
  const arquivo = useRef<HTMLInputElement>(null);
  const [corpo, setCorpo] = useState('');
  const [interna, setInterna] = useState(false);
  const [anexos, setAnexos] = useState<AnexoChamado[]>([]);
  const [subindo, setSubindo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const anexar = async (f: File) => {
    if (anexos.length >= 5) return toast.error('No máximo 5 anexos por mensagem.');
    setSubindo(true);
    try {
      const a = await enviarArquivo<AnexoChamado>(rotaAnexo, f);
      setAnexos((s) => [...s, a]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubindo(false);
      if (arquivo.current) arquivo.current.value = '';
    }
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      await onEnviar({ corpo: corpo.trim(), interna, anexos });
      setCorpo('');
      setAnexos([]);
      setInterna(false);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={cn('rounded-[12px] border p-3', interna ? 'border-warning-500/50 bg-warning-50/50' : 'border-ink-200')}>
      <Textarea
        value={corpo}
        onChange={(e) => setCorpo(e.target.value)}
        placeholder={interna ? 'Nota interna (o órgão não vê)' : 'Escreva a resposta'}
        className="min-h-24 border-0 p-0 shadow-none focus:ring-0"
        disabled={desabilitado}
        aria-label="Mensagem"
      />
      {anexos.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {anexos.map((a) => (
            <li key={a.key} className="inline-flex items-center gap-1 rounded-[8px] bg-ink-100 px-2 py-1 text-xs text-ink-700">
              {a.nome}
              <button type="button" aria-label={`Remover ${a.nome}`} onClick={() => setAnexos((s) => s.filter((x) => x.key !== a.key))}>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={arquivo}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void anexar(f);
          }}
        />
        <Button type="button" size="sm" variant="ghost" disabled={desabilitado || subindo} onClick={() => arquivo.current?.click()} leftIcon={subindo ? <Loader2 className="animate-spin" aria-hidden /> : <Paperclip aria-hidden />}>
          Anexar
        </Button>
        {podeInterna && (
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-700">
            <input type="checkbox" checked={interna} onChange={(e) => setInterna(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Nota interna
          </label>
        )}
        <Button className="ml-auto" size="sm" leftIcon={<Send aria-hidden />} loading={enviando} disabled={desabilitado || !corpo.trim()} onClick={enviar}>
          {interna ? 'Salvar nota' : 'Enviar'}
        </Button>
      </div>
    </div>
  );
}
