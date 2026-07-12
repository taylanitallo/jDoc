'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, MessageCircleQuestion, Send, Sparkles, X } from 'lucide-react';
import type { AssistenteResposta, DocumentView } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { btnGhost, cardCls, inputCls } from '@/components/ui';
import { useToast } from '@/components/toast';

interface Turno {
  id: string;
  pergunta: string;
  loading: boolean;
  resposta?: AssistenteResposta;
  erro?: string;
}

/**
 * Assistente de busca por IA — widget flutuante (canto inferior direito,
 * disponivel em qualquer tela do app, nao so na listagem de documentos).
 * "Pergunte em português" sobre os documentos do tenant; traduz a pergunta
 * em consultas estruturadas no backend (nunca busca no corpo do PDF). Cada
 * pergunta e independente no backend — o historico do "chat" e so local
 * (nao persistido), pra dar a sensacao de conversa sem guardar estado.
 */
export function AssistenteWidget() {
  const { slug } = useParams<{ slug: string }>();
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState('');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turnos]);

  const perguntar = async () => {
    const pergunta = texto.trim();
    if (!pergunta || !slug) return;
    const id = crypto.randomUUID();
    setTexto('');
    setTurnos((prev) => [...prev, { id, pergunta, loading: true }]);
    try {
      const resposta = await api<AssistenteResposta>(`/t/${slug}/assistente/perguntar`, {
        method: 'POST',
        body: { pergunta },
      });
      setTurnos((prev) => prev.map((t) => (t.id === id ? { ...t, loading: false, resposta } : t)));
    } catch (e) {
      const erro = e instanceof ApiError ? e.message : 'Erro ao consultar o assistente';
      setTurnos((prev) => prev.map((t) => (t.id === id ? { ...t, loading: false, erro } : t)));
    }
  };

  const abrirDocumento = async (doc: DocumentView) => {
    if (!slug) return;
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

  if (!slug) return null;

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-50 flex h-[32rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-app-border bg-app-card shadow-2xl sm:right-6">
          <div className="flex items-center gap-3 bg-gradient-modal px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
              <Sparkles className="h-5 w-5 text-white" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">Assistente jDoc</p>
              <p className="flex items-center gap-1 text-[11px] text-white/80">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden /> Pronto pra ajudar
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar assistente"
              className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4.5 w-4.5" aria-hidden />
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {turnos.length === 0 && (
              <div className="rounded-xl bg-app-input-bg p-3 text-xs text-app-muted">
                <p className="mb-1 font-semibold text-app">Como posso ajudar?</p>
                <p>Pergunte em português sobre os documentos, ex:</p>
                <p className="mt-1 italic">"quanto foi gasto com saúde em 2026?"</p>
              </div>
            )}
            {turnos.map((t) => (
              <div key={t.id} className="space-y-1.5">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-xl rounded-br-sm bg-gradient-primary px-3 py-1.5 text-xs text-white">
                    {t.pergunta}
                  </p>
                </div>
                {t.loading && (
                  <p className="text-xs text-app-muted">Consultando os documentos…</p>
                )}
                {t.erro && (
                  <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-1.5 text-xs text-app-error-text">
                    {t.erro}
                  </p>
                )}
                {t.resposta && (
                  <div className="space-y-1.5">
                    <p className="max-w-[90%] whitespace-pre-wrap rounded-xl rounded-bl-sm bg-app-input-bg px-3 py-1.5 text-xs text-app">
                      {t.resposta.resposta}
                    </p>
                    {t.resposta.documentos.length > 0 && (
                      <div className="space-y-1">
                        {t.resposta.documentos.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => void abrirDocumento(doc)}
                            className={`${cardCls} flex w-[90%] items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] transition hover:bg-app-hover`}
                          >
                            <span className="min-w-0 truncate text-app">
                              {doc.docCaixa ? `Doc. Caixa ${doc.docCaixa}` : doc.descricao || doc.historico || doc.originalName}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-app-muted">
                              {doc.value !== null &&
                                doc.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                              <ExternalLink className="h-3 w-3" aria-hidden />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t border-app-border p-2.5">
            <input
              className={inputCls}
              placeholder="Pergunte algo…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void perguntar();
              }}
            />
            <button
              type="button"
              onClick={() => void perguntar()}
              disabled={!texto.trim()}
              aria-label="Enviar pergunta"
              className={`${btnGhost} shrink-0 !px-2.5`}
            >
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Fechar assistente de busca por IA' : 'Abrir assistente de busca por IA'}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-white shadow-2xl transition hover:opacity-90 sm:right-6"
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <MessageCircleQuestion className="h-6 w-6" aria-hidden />}
      </button>
    </>
  );
}
