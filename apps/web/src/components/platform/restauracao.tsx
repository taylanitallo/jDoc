'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, Upload, XCircle } from 'lucide-react';
import { ETAPAS_RESTAURACAO, type RestoreJobView } from '@jdoc/shared';
import { api, pedirReauth } from '@/lib/api';
import { restoreTenantBackup } from '@/lib/upload';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/toast';

/** Acompanha uma restauracao (polling) e mostra as etapas. */
export function ProgressoRestauracao({ id, onFim }: { id: string; onFim?: (ok: boolean) => void }) {
  const [r, setR] = useState<RestoreJobView | null>(null);
  const fimRef = useRef(onFim);
  fimRef.current = onFim;

  useEffect(() => {
    let ativo = true;
    let t: ReturnType<typeof setTimeout>;
    const ler = async () => {
      try {
        const v = await api<RestoreJobView>(`/superadmin/backups/restore/${id}`);
        if (!ativo) return;
        setR(v);
        if (v.status === 'concluido' || v.status === 'erro') return fimRef.current?.(v.status === 'concluido');
      } catch {
        // tenta de novo no proximo ciclo
      }
      t = setTimeout(() => void ler(), 2500);
    };
    void ler();
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [id]);

  const idxAtual = ETAPAS_RESTAURACAO.findIndex((e) => e.id === (r?.step ?? 'fila'));
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {ETAPAS_RESTAURACAO.map((e, i) => {
          const feito = r?.status === 'concluido' || i < idxAtual;
          const agora = i === idxAtual && r?.status !== 'concluido' && r?.status !== 'erro';
          const falhou = i === idxAtual && r?.status === 'erro';
          return (
            <li key={e.id} className="flex items-center gap-2 text-sm">
              {falhou ? (
                <XCircle className="h-4 w-4 text-danger-600" aria-hidden />
              ) : feito ? (
                <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden />
              ) : agora ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 text-ink-300" aria-hidden />
              )}
              <span className={cn(feito || agora ? 'text-ink-900' : 'text-ink-400', falhou && 'text-danger-600')}>{e.label}</span>
            </li>
          );
        })}
      </ol>
      {r?.status === 'erro' && (
        <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {r.erroMensagem ?? 'A restauração falhou.'} O órgão continua com os dados que tinha antes.
        </p>
      )}
    </div>
  );
}

/** Restaurar enviando um arquivo .dump.gz proprio (so owner; pede confirmacao de identidade). */
export function RestaurarArquivo({ tenantId, nomeOrgao }: { tenantId: string; nomeOrgao: string }) {
  const toast = useToast();
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [restauracao, setRestauracao] = useState<string | null>(null);

  const enviar = async (file: File, tentouReauth = false): Promise<void> => {
    setEnviando(true);
    setProgresso(0);
    try {
      const r = await restoreTenantBackup(tenantId, file, setProgresso);
      if (!r.ok) {
        if (r.code === 'reauth_required' && !tentouReauth && (await pedirReauth())) return enviar(file, true);
        toast.error(r.message);
        return;
      }
      setRestauracao((r.body as { id: string }).id);
    } finally {
      setEnviando(false);
      if (arquivo.current) arquivo.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-[10px] bg-warning-50 p-3 text-sm text-warning-600">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Substitui todos os dados de <strong>{nomeOrgao}</strong>. Antes é feito um backup de segurança e, durante a troca, o órgão fica em manutenção.
          Se algo falhar, os dados atuais permanecem.
        </p>
      </div>
      {restauracao ? (
        <ProgressoRestauracao id={restauracao} onFim={(ok) => (ok ? toast.success('Restauração concluída.') : toast.error('A restauração falhou.'))} />
      ) : (
        <>
          <input
            ref={arquivo}
            type="file"
            accept=".gz"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviar(f);
            }}
          />
          <button
            type="button"
            disabled={enviando}
            onClick={() => arquivo.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-[12px] border-2 border-dashed border-ink-200 p-8 text-center transition hover:border-brand-500 disabled:opacity-60"
          >
            {enviando ? <Loader2 className="h-7 w-7 animate-spin text-brand-600" aria-hidden /> : <Upload className="h-7 w-7 text-ink-500" aria-hidden />}
            <span className="text-sm font-semibold text-ink-800">{enviando ? `Enviando… ${progresso}%` : 'Selecionar arquivo .dump.gz'}</span>
            <span className="text-xs text-ink-500">Só arquivos gerados por este sistema, deste órgão.</span>
          </button>
        </>
      )}
    </div>
  );
}
