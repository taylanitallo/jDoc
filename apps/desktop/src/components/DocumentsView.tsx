import { useEffect, useState } from 'react';
import type { DocumentPage } from '@jdoc/shared';
import { MODULE_LABELS, MODULES } from '../upload-fields';
import { PdfViewer } from './PdfViewer';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ListPayload {
  module: string;
  page: number;
  q?: string;
  competencia?: string;
}

/**
 * Listagem de documentos com filtros minimos (modulo, competencia, busca) e
 * paginacao simples. `module` e obrigatorio no backend, entao sempre ha um
 * selecionado. Clicar num item abre o visualizador de PDF.
 */
export function DocumentsView() {
  const [module, setModule] = useState<string>(MODULES[0]);
  const [q, setQ] = useState('');
  const [competencia, setCompetencia] = useState('');
  const [data, setData] = useState<DocumentPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);

  async function load(page: number) {
    setLoading(true);
    setError(null);
    try {
      const payload: ListPayload = { module, page };
      if (q.trim()) payload.q = q.trim();
      if (competencia) payload.competencia = competencia;
      const res = (await window.jdoc.invoke('documents:list', payload)) as DocumentPage;
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao listar documentos');
    } finally {
      setLoading(false);
    }
  }

  // Recarrega ao trocar de modulo (filtro obrigatorio).
  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  const page = data?.page ?? 1;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="docs">
      <div className="docs-filters">
        <select value={module} onChange={(e) => setModule(e.target.value)}>
          {MODULES.map((m) => (
            <option key={m} value={m}>
              {MODULE_LABELS[m] ?? m}
            </option>
          ))}
        </select>
        <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} placeholder="competência" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="buscar…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(1);
          }}
        />
        <button type="button" className="up-btn" onClick={() => void load(1)}>
          Filtrar
        </button>
      </div>

      {loading && <p className="docs-msg">Carregando…</p>}
      {error && <p className="docs-msg docs-error">{error}</p>}

      {data && !loading && (
        <>
          <ul className="docs-list">
            {data.items.map((doc) => (
              <li key={doc.id} className="docs-row">
                <span className="docs-name" title={doc.originalName}>
                  {doc.originalName}
                </span>
                <span className="docs-meta">{doc.competencia ?? doc.documentDate ?? '—'}</span>
                <span className="docs-meta">{doc.credor ?? ''}</span>
                <span className="docs-meta">{formatSize(doc.fileSize)}</span>
                <button
                  type="button"
                  className="up-btn"
                  onClick={() => setViewing({ id: doc.id, name: doc.originalName })}
                >
                  Ver
                </button>
              </li>
            ))}
            {data.items.length === 0 && <li className="docs-empty">Nenhum documento.</li>}
          </ul>

          <div className="docs-pager">
            <button type="button" className="up-btn" disabled={page <= 1} onClick={() => void load(page - 1)}>
              ‹ Anterior
            </button>
            <span className="docs-page">
              {page} / {totalPages} · {data.total} doc(s)
            </span>
            <button type="button" className="up-btn" disabled={page >= totalPages} onClick={() => void load(page + 1)}>
              Próxima ›
            </button>
          </div>
        </>
      )}

      {viewing && (
        <PdfViewer documentId={viewing.id} title={viewing.name} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
