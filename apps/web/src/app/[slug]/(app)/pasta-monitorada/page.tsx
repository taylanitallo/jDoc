'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { FolderSync, FileUp, Trash2, Link2, AlertTriangle } from 'lucide-react';
import type { EtiquetaCandidate } from '@jdoc/shared';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/empty-state';
import { cardCls, btnPrimary, btnGhost, formatBytes } from '@/components/ui';
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

export default function PastaMonitoradaPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();
  const qc = useQueryClient();

  const [checked, setChecked] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);

  // Checagem client-only (evita mismatch de hidratacao — servidor nao sabe se e desktop).
  useEffect(() => {
    const isDesktop = isDesktopApp();
    setDesktop(isDesktop);
    setChecked(true);
    if (!isDesktop) return;

    void (async () => {
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

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-app">
          <FolderSync className="h-6 w-6 text-accent" aria-hidden />
          Pasta Monitorada
        </h1>
        <p className="mt-1 text-app-muted">
          Solte os PDFs nomeados pelo documento de caixa (ex.: <code>2020001.pdf</code>) na pasta abaixo.
          Cada arquivo é vinculado à etiqueta de despesa com o mesmo número.
        </p>
      </div>

      <div className={`${cardCls} flex items-center gap-4 p-4`}>
        {folder ? (
          <>
            <span className="flex-1 truncate text-sm text-app" title={folder}>
              <b className="text-app-muted">Pasta monitorada:</b> {folder}
            </span>
            <button type="button" className={btnGhost} onClick={() => void stopWatching()} disabled={folderBusy}>
              parar monitoramento
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-sm text-app-muted">Nenhuma pasta monitorada.</span>
            <button type="button" className={btnPrimary} onClick={() => void chooseFolder()} disabled={folderBusy}>
              escolher pasta
            </button>
          </>
        )}
      </div>

      {files.length === 0 ? (
        <EmptyState
          icon={FileUp}
          title="Nenhum arquivo pendente"
          description="Solte um PDF (nomeado pelo doc de caixa) na pasta monitorada para vinculá-lo à etiqueta."
        />
      ) : (
        <ul className="space-y-3">
          {files.map((f) => (
            <PendingRow key={f.fileId} slug={slug} file={f} toast={toast} qc={qc} />
          ))}
        </ul>
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
      // de outros arquivos com o mesmo doc de caixa. O arquivo some via onWatchPending.
      await qc.invalidateQueries({ queryKey: ['etiquetas', slug, file.docCaixa] });
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
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app" title={file.name}>
          {file.name}
        </span>
        <span className="rounded bg-app-badge-gray-bg px-2 py-0.5 text-xs text-app-badge-gray-text">
          Doc. caixa: <b>{file.docCaixa}</b>
        </span>
        <span className="text-xs text-app-muted">{formatBytes(file.size)}</span>
      </div>

      {isLoading ? (
        <p className="text-xs text-app-muted">Buscando etiqueta…</p>
      ) : !etiquetas || etiquetas.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700">
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
            <p className="text-xs font-semibold text-app-muted">
              Mais de uma etiqueta com esse documento de caixa — escolha a que este arquivo pertence:
            </p>
          )}
          <div className="space-y-1.5">
            {etiquetas.map((e) => (
              <label
                key={e.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-app-border p-2.5 text-sm hover:border-accent"
              >
                <input
                  type="radio"
                  name={`et-${file.fileId}`}
                  checked={selected === e.id}
                  onChange={() => setSelected(e.id)}
                />
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-app">
                  <span>
                    <span className="text-app-muted">Empenho</span> {e.empenho ?? '—'}
                  </span>
                  <span>
                    <span className="text-app-muted">Credor</span> {e.credor ?? '—'}
                  </span>
                  <span className="font-semibold">{formatBRL(e.value)}</span>
                  <span className="text-app-muted">{e.documentDate ?? '—'}</span>
                  {e.subtype && (
                    <span className="text-app-muted">{SUBTYPE_LABEL[e.subtype] ?? e.subtype}</span>
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
