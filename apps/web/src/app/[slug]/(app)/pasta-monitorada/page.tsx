'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  FolderSync,
  FileUp,
  Trash2,
  Link2,
  AlertTriangle,
  ArrowUpCircle,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  CheckCheck,
} from 'lucide-react';
import type { EtiquetaCandidate, EtiquetasPendentesResult } from '@jdoc/shared';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/empty-state';
import { cardCls, btnPrimary, btnGhost, formatBytes, PageHeader } from '@/components/ui';
import { isDesktopApp, desktopInvoke } from '@/lib/desktop-bridge';

/**
 * Pasta Monitorada — vinculo do PDF a ETIQUETA pelo documento de caixa.
 *
 * So existe dentro do jDoc Desktop. O processo main detecta PDFs soltos numa
 * pasta local; cada arquivo e nomeado pelo doc de caixa (ex.: "2020001.pdf",
 * ou "2020001-1.pdf"/"2020001-2.pdf" quando ha mais de um pro mesmo numero).
 * Aqui cada arquivo e casado com a etiqueta de DESPESA "aguardando arquivo" que
 * tem aquele doc de caixa: 1 candidata -> confirma; varias -> o usuario escolhe
 * (pelo empenho/credor/valor); nenhuma -> avisa "sem etiqueta correspondente".
 */

interface PendingFile {
  fileId: string;
  name: string;
  docCaixa: string;
  size: number;
  detectedAt: string;
}

const SUBTYPE_LABEL: Record<string, string> = {
  orcamentaria: 'Orçamentária',
  extraorcamentaria: 'Extraorçamentária',
  resto_a_pagar: 'Resto a Pagar',
};

function formatBRL(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Primeira versao do desktop com o vinculo por doc de caixa (watch:attach). */
const MIN_DESKTOP_VERSION = '1.0.2';
function versionAtLeast(cur: string, min: string): boolean {
  const pa = cur.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export default function PastaMonitoradaPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();
  const qc = useQueryClient();

  const [checked, setChecked] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [showPendentes, setShowPendentes] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  // Etiquetas de despesa que ainda estao sem PDF (painel + total).
  const { data: pendentes } = useQuery({
    queryKey: ['etiquetas-pendentes', slug],
    queryFn: () =>
      api<EtiquetasPendentesResult>(`/t/${slug}/documents/etiquetas-pendentes?module=despesas`),
    enabled: desktop && !outdated,
  });

  // Checagem client-only (evita mismatch de hidratacao — servidor nao sabe se e desktop).
  useEffect(() => {
    const isDesktop = isDesktopApp();
    setDesktop(isDesktop);
    setChecked(true);
    if (!isDesktop) return;

    void (async () => {
      // Versao antiga do desktop nao tem o vinculo por doc de caixa (watch:attach).
      const v = await desktopInvoke<{ version: string }>('app:version');
      if (!versionAtLeast(v?.version ?? '0.0.0', MIN_DESKTOP_VERSION)) {
        setOutdated(true);
        return;
      }
      const cfg = await desktopInvoke<{ folder: string | null }>('watch:get-config');
      setFolder(cfg?.folder ?? null);
      const res = await desktopInvoke<{ items: PendingFile[] }>('watch:list-pending');
      setFiles(res?.items ?? []);
    })();
    // O main emite a lista COMPLETA de pendentes a cada mudanca (deteccao/anexo/descarte).
    const off = window.jdoc!.onWatchPending((items) => setFiles(items as PendingFile[]));
    return off;
  }, []);

  async function chooseFolder() {
    setFolderBusy(true);
    try {
      const res = await desktopInvoke<{ folder: string | null }>('watch:choose-folder');
      setFolder(res?.folder ?? null);
    } finally {
      setFolderBusy(false);
    }
  }

  async function stopWatching() {
    setFolderBusy(true);
    try {
      await desktopInvoke('watch:stop');
      setFolder(null);
      setFiles([]);
    } finally {
      setFolderBusy(false);
    }
  }

  /**
   * Vincula de uma vez todos os arquivos que casam com EXATAMENTE UMA etiqueta
   * (sem ambiguidade). Pula os que tem varias candidatas (o usuario escolhe) e
   * os sem etiqueta. Evita usar a mesma etiqueta pra dois arquivos no mesmo lote.
   */
  async function vincularTodos() {
    setBatchBusy(true);
    const usados = new Set<string>();
    let ok = 0;
    let ambiguos = 0;
    let semEtiqueta = 0;
    try {
      for (const f of files) {
        const cands = await qc.fetchQuery({
          queryKey: ['etiquetas', slug, f.docCaixa],
          queryFn: () =>
            api<EtiquetaCandidate[]>(
              `/t/${slug}/documents/etiquetas?module=despesas&docCaixa=${encodeURIComponent(f.docCaixa)}`,
            ),
        });
        const livres = cands.filter((c) => !usados.has(c.id));
        if (livres.length === 0) {
          if (cands.length === 0) semEtiqueta++;
          else ambiguos++; // todas as candidatas ja foram usadas neste lote
          continue;
        }
        if (livres.length > 1) {
          ambiguos++;
          continue;
        }
        const etiqueta = livres[0]!;
        try {
          await window.jdoc!.invoke('watch:attach', { fileId: f.fileId, documentId: etiqueta.id });
          usados.add(etiqueta.id);
          ok++;
        } catch {
          // falha pontual (rede/quota) — segue os demais.
        }
      }
      await qc.invalidateQueries({ queryKey: ['etiquetas'] });
      await qc.invalidateQueries({ queryKey: ['etiquetas-pendentes', slug] });
      const partes = [`${ok} vinculado(s)`];
      if (ambiguos > 0) partes.push(`${ambiguos} com escolha pendente`);
      if (semEtiqueta > 0) partes.push(`${semEtiqueta} sem etiqueta`);
      if (ok > 0) toast.success(partes.join(' · '));
      else toast.info(partes.join(' · '));
    } finally {
      setBatchBusy(false);
    }
  }

  if (!checked) return null;

  if (!desktop) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FolderSync}
          title="Disponível apenas no jDoc Desktop"
          description="Instale o aplicativo desktop para monitorar uma pasta local e vincular PDFs às etiquetas automaticamente."
        />
      </div>
    );
  }

  if (outdated) {
    return (
      <div className="p-6">
        <EmptyState
          icon={ArrowUpCircle}
          title="Atualize o jDoc Desktop"
          description="O vínculo automático por documento de caixa está disponível a partir da versão mais recente. Feche e abra o jDoc — ele atualiza sozinho antes do login."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pasta monitorada"
        description={
          <>
            Solte os PDFs nomeados pelo documento de caixa (ex.: <code className="rounded-[6px] bg-ink-100 px-1 py-0.5 text-[13px]">2020001.pdf</code>) na
            pasta abaixo. Cada arquivo é vinculado à etiqueta de despesa com o mesmo número.
          </>
        }
      />

      <div className={`${cardCls} p-4`}>
        <div className="flex flex-wrap items-center gap-3">
          {folder ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-800" title={folder}>
                <b className="text-ink-500">Pasta monitorada:</b> {folder}
              </span>
              <button
                type="button"
                className={btnGhost}
                onClick={() => setShowPendentes((s) => !s)}
                title="Etiquetas de despesa que ainda estão sem arquivo"
              >
                <ClipboardList className="h-4 w-4" aria-hidden />
                Etiquetas aguardando arquivo
                {pendentes ? <b className="ml-1">({pendentes.total})</b> : null}
                {showPendentes ? (
                  <ChevronUp className="h-4 w-4" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden />
                )}
              </button>
              <button type="button" className={btnGhost} onClick={() => void stopWatching()} disabled={folderBusy}>
                parar monitoramento
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm text-ink-500">Nenhuma pasta monitorada.</span>
              <button type="button" className={btnPrimary} onClick={() => void chooseFolder()} disabled={folderBusy}>
                escolher pasta
              </button>
            </>
          )}
        </div>

        {folder && showPendentes && (
          <div className="mt-3 border-t border-ink-200 pt-3">
            {!pendentes ? (
              <p className="text-xs text-ink-500">Carregando…</p>
            ) : pendentes.items.length === 0 ? (
              <p className="text-xs text-ink-500">Nenhuma etiqueta de despesa aguardando arquivo. 🎉</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-ink-500">
                  {pendentes.total} etiqueta(s) de despesa ainda sem PDF
                  {pendentes.total > pendentes.items.length ? ` (mostrando ${pendentes.items.length})` : ''}:
                </p>
                <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                  {pendentes.items.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded border border-ink-200 px-2.5 py-1.5 text-xs"
                    >
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-600">
                        {e.docCaixa ?? '—'}
                      </span>
                      <span className="text-ink-500">Emp. {e.empenho ?? '—'}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-800">{e.credor ?? '—'}</span>
                      <span className="font-semibold text-ink-800">{formatBRL(e.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {files.length === 0 ? (
        <EmptyState
          icon={FileUp}
          title="Nenhum arquivo pendente"
          description="Solte um PDF (nomeado pelo doc de caixa) na pasta monitorada para vinculá-lo à etiqueta."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-ink-500">
              {files.length} arquivo(s) na pasta.
            </p>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void vincularTodos()}
              disabled={batchBusy}
              title="Vincula de uma vez os arquivos que casam com exatamente uma etiqueta"
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              {batchBusy ? 'Vinculando…' : 'Vincular todos os compatíveis'}
            </button>
          </div>
          <ul className="space-y-3">
            {files.map((f) => (
              <PendingRow key={f.fileId} slug={slug} file={f} toast={toast} qc={qc} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PendingRow({
  slug,
  file,
  toast,
  qc,
}: {
  slug: string;
  file: PendingFile;
  toast: ReturnType<typeof useToast>;
  qc: QueryClient;
}) {
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const { data: etiquetas, isLoading } = useQuery({
    queryKey: ['etiquetas', slug, file.docCaixa],
    queryFn: () =>
      api<EtiquetaCandidate[]>(
        `/t/${slug}/documents/etiquetas?module=despesas&docCaixa=${encodeURIComponent(file.docCaixa)}`,
      ),
  });

  // Pre-seleciona quando ha exatamente uma candidata (o usuario ainda confirma).
  useEffect(() => {
    if (etiquetas && etiquetas.length === 1 && etiquetas[0] && !selected) {
      setSelected(etiquetas[0].id);
    }
  }, [etiquetas, selected]);

  async function vincular() {
    if (!selected) return;
    setBusy(true);
    try {
      await window.jdoc!.invoke('watch:attach', { fileId: file.fileId, documentId: selected });
      toast.success(`${file.name} vinculado à etiqueta ${file.docCaixa}.`);
      // A etiqueta usada deixa de ser "aguardando_arquivo": revalida para sumir
      // de outros arquivos com o mesmo doc de caixa e atualizar o painel de
      // pendentes. O arquivo some via onWatchPending.
      await qc.invalidateQueries({ queryKey: ['etiquetas', slug, file.docCaixa] });
      await qc.invalidateQueries({ queryKey: ['etiquetas-pendentes', slug] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao vincular o arquivo.');
      setBusy(false);
    }
  }

  async function descartar() {
    await desktopInvoke('watch:dismiss', { fileId: file.fileId });
  }

  const varias = (etiquetas?.length ?? 0) > 1;

  return (
    <li className={`${cardCls} space-y-3 p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800" title={file.name}>
          {file.name}
        </span>
        <span className="rounded bg-ink-100 px-2 py-0.5 text-xs text-ink-600">
          Doc. caixa: <b>{file.docCaixa}</b>
        </span>
        <span className="text-xs text-ink-500">{formatBytes(file.size)}</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-ink-500">Buscando etiqueta…</p>
      ) : !etiquetas || etiquetas.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-orange-500/30 bg-orange-50 p-3 text-sm text-orange-600">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">
            Sem etiqueta de despesa aguardando arquivo com o documento de caixa <b>{file.docCaixa}</b>.
            Importe a etiqueta correspondente ou descarte o arquivo.
          </span>
          <button type="button" className={btnGhost} onClick={() => void descartar()}>
            <Trash2 className="h-4 w-4" aria-hidden /> descartar
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {varias && (
            <p className="text-xs font-semibold text-ink-500">
              Mais de uma etiqueta com esse documento de caixa — escolha a que este arquivo pertence:
            </p>
          )}
          <div className="space-y-1.5">
            {etiquetas.map((e) => (
              <label
                key={e.id}
                className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-ink-200 p-2.5 text-sm hover:border-accent"
              >
                <input
                  type="radio"
                  name={`et-${file.fileId}`}
                  checked={selected === e.id}
                  onChange={() => setSelected(e.id)}
                />
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-800">
                  <span>
                    <span className="text-ink-500">Empenho</span> {e.empenho ?? '—'}
                  </span>
                  <span>
                    <span className="text-ink-500">Credor</span> {e.credor ?? '—'}
                  </span>
                  <span className="font-semibold">{formatBRL(e.value)}</span>
                  <span className="text-ink-500">{e.documentDate ?? '—'}</span>
                  {e.subtype && (
                    <span className="text-ink-500">{SUBTYPE_LABEL[e.subtype] ?? e.subtype}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className={btnPrimary}
              disabled={!selected || busy}
              onClick={() => void vincular()}
            >
              <Link2 className="h-4 w-4" aria-hidden /> {busy ? 'Vinculando…' : 'Vincular'}
            </button>
            <button type="button" className={btnGhost} onClick={() => void descartar()}>
              <Trash2 className="h-4 w-4" aria-hidden /> descartar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
