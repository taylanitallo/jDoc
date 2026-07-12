'use client';

import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { AssistenteResposta, DocumentView } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Modal, btnGhost, btnPrimary, cardCls, inputCls } from '@/components/ui';
import { useToast } from '@/components/toast';

/**
 * Assistente de busca por IA — "pergunte em português" sobre os documentos
 * do tenant. Traduz a pergunta em consultas estruturadas no backend (nunca
 * busca no corpo do PDF); a resposta cita os documentos-fonte, clicaveis
 * pra abrir o PDF real via signed URL.
 */
export function AssistenteModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [pergunta, setPergunta] = useState('');
  const [loading, setLoading] = useState(false);
  const [resposta, setResposta] = useState<AssistenteResposta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const perguntar = async () => {
    const texto = pergunta.trim();
    if (!texto || loading) return;
    setLoading(true);
    setError(null);
    setResposta(null);
    try {
      const res = await api<AssistenteResposta>(`/t/${slug}/assistente/perguntar`, {
        method: 'POST',
        body: { pergunta: texto },
      });
      setResposta(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao consultar o assistente');
    } finally {
      setLoading(false);
    }
  };

  const abrirDocumento = async (doc: DocumentView) => {
    const win = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(`/t/${slug}/documents/${doc.id}/url`);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      toast.error(e instanceof ApiError ? e.message : 'Erro ao abrir PDF');
    }
  };

  return (
    <Modal title="Assistente de Busca (IA)" subtitle="Pergunte em português sobre os documentos" open onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="ex.: quanto foi gasto com saúde em 2026?"
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void perguntar();
            }}
            disabled={loading}
            autoFocus
          />
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void perguntar()}
            disabled={loading || !pergunta.trim()}
          >
            {loading ? 'Pensando…' : 'Perguntar'}
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-app-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Consultando os documentos…
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
            {error}
          </p>
        )}

        {resposta && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap text-sm text-app">{resposta.resposta}</p>

            {resposta.avisos.length > 0 && (
              <ul className="space-y-1 text-xs text-app-muted">
                {resposta.avisos.map((aviso, i) => (
                  <li key={i}>⚠ {aviso}</li>
                ))}
              </ul>
            )}

            {resposta.documentos.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase text-app-muted">
                  Documentos citados ({resposta.documentos.length})
                </p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {resposta.documentos.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => void abrirDocumento(doc)}
                      className={`${cardCls} flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition hover:bg-app-hover`}
                    >
                      <span className="min-w-0 truncate text-app">
                        {doc.docCaixa ? `Doc. Caixa ${doc.docCaixa}` : doc.descricao || doc.historico || doc.originalName}
                        {doc.credor && <span className="text-app-muted"> — {doc.credor}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-app-muted">
                        {doc.value !== null &&
                          doc.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" className={btnGhost} onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}
