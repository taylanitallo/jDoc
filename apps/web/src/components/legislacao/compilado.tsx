'use client';

import Link from 'next/link';
import { AGRUPADORES, notaEvento, rotuloExibicao, type NoCompilado, type NormaRef, type NormaRelacaoView, type NormaResumoView } from '@jdoc/shared';
import { cn } from '@/lib/cn';

/**
 * Texto compilado no estilo do Planalto: redacoes superadas riscadas em cinza, nota
 * azul "(Redação dada pela Lei nº X)" com link para a norma alteradora e "(Revogado)".
 * `mostrarHistorico=false` mostra so o texto em vigor (leitura limpa).
 */
export function TextoCompilado({
  nos,
  linkNorma,
  mostrarHistorico = true,
  destaque,
}: {
  nos: NoCompilado[];
  linkNorma?: (n: NormaRef) => string;
  mostrarHistorico?: boolean;
  /** Termo buscado: realca no texto. */
  destaque?: string;
}) {
  return (
    <div className="font-serif text-[15px] leading-relaxed text-ink-900">
      {nos.map((n) => (
        <No key={n.id} no={n} linkNorma={linkNorma} mostrarHistorico={mostrarHistorico} destaque={destaque} nivel={0} />
      ))}
    </div>
  );
}

function Realce({ texto, termo }: { texto: string; termo?: string }) {
  if (!termo || termo.trim().length < 3) return <>{texto}</>;
  const partes = texto.split(new RegExp(`(${termo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {partes.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-warning-200/70 px-0.5 text-inherit">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Nota({ texto, norma, linkNorma }: { texto: string; norma: NormaRef | null; linkNorma?: (n: NormaRef) => string }) {
  const classe = 'ml-1 font-sans text-[13px] text-brand-600';
  if (norma && linkNorma) {
    return (
      <Link href={linkNorma(norma)} className={cn(classe, 'hover:underline')}>
        {texto}
      </Link>
    );
  }
  return <span className={classe}>{texto}</span>;
}

function No({
  no,
  linkNorma,
  mostrarHistorico,
  destaque,
  nivel,
}: {
  no: NoCompilado;
  linkNorma?: (n: NormaRef) => string;
  mostrarHistorico: boolean;
  destaque?: string;
  nivel: number;
}) {
  const agrupador = AGRUPADORES.includes(no.tipo);
  const recuo = no.tipo === 'paragrafo' || no.tipo === 'inciso' ? 'pl-0' : no.tipo === 'alinea' ? 'pl-6' : no.tipo === 'item' ? 'pl-12' : '';
  const atual = no.historico.find((h) => h.vigente);
  const notaAtual = atual ? notaEvento(atual) : null;
  const anteriores = mostrarHistorico ? no.historico.filter((h) => !h.vigente && h.texto) : [];
  const rot = rotuloExibicao(no.tipo, no.rotulo);

  if (agrupador) {
    return (
      <section id={`d-${no.id}`} className="mt-6 first:mt-0">
        <p className="text-center font-sans text-sm font-bold uppercase tracking-wide text-ink-800">{no.rotulo}</p>
        {no.texto && <p className="text-center font-sans text-sm font-bold uppercase text-ink-800">{no.texto}</p>}
        {notaAtual && (
          <p className="text-center">
            <Nota texto={notaAtual} norma={atual?.normaAlteradora ?? null} linkNorma={linkNorma} />
          </p>
        )}
        <div className="mt-3">
          {no.filhos.map((f) => (
            <No key={f.id} no={f} linkNorma={linkNorma} mostrarHistorico={mostrarHistorico} destaque={destaque} nivel={nivel + 1} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <div id={`d-${no.id}`} className={cn('scroll-mt-24', recuo)}>
      {anteriores.map((h, i) => (
        <p key={i} className="my-1 text-ink-400">
          <span className="line-through decoration-ink-400/70">
            {rot && <span className={no.tipo === 'artigo' ? 'font-semibold' : ''}>{rot} </span>}
            {h.texto}
          </span>
          {notaEvento(h) && <Nota texto={notaEvento(h)!} norma={h.normaAlteradora} linkNorma={linkNorma} />}
        </p>
      ))}
      <p
        className={cn(
          'my-2',
          no.tipo === 'fecho' && 'mt-6 whitespace-pre-line text-ink-600',
          no.tipo === 'preambulo' && 'mb-5 text-ink-700',
          // Como no Planalto: epigrafe centralizada, ementa recuada a direita em italico.
          no.rotulo === 'Epígrafe' && no.tipo === 'preambulo' && 'mb-4 text-center font-sans font-bold uppercase tracking-wide text-ink-900',
          no.rotulo === 'Ementa' && no.tipo === 'preambulo' && 'mb-6 ml-auto max-w-md text-justify italic text-ink-700',
          no.revogado && 'text-ink-500',
        )}
      >
        {rot && <span className={no.tipo === 'artigo' ? 'font-bold' : 'font-medium'}>{rot} </span>}
        {no.revogado ? <span className="italic">(Revogado)</span> : <Realce texto={no.texto ?? ''} termo={destaque} />}
        {notaAtual && <Nota texto={notaAtual} norma={atual?.normaAlteradora ?? null} linkNorma={linkNorma} />}
      </p>
      {no.filhos.length > 0 && (
        <div>
          {no.filhos.map((f) => (
            <No key={f.id} no={f} linkNorma={linkNorma} mostrarHistorico={mostrarHistorico} destaque={destaque} nivel={nivel + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export const SITUACAO_TOM = {
  vigente: 'success',
  alterada: 'info',
  revogada_parcial: 'warning',
  revogada: 'danger',
} as const;

const REL_LABEL: Record<NormaRelacaoView['tipo'], string> = { altera: 'altera', revoga: 'revoga', revoga_parcialmente: 'revoga em parte' };

/** Uma linha por norma: "Decreto nº 45/2021 (altera, revoga em parte)". */
export function agruparRelacoes(itens: NormaRelacaoView[]): Array<{ norma: NormaResumoView; tipos: string }> {
  const m = new Map<string, { norma: NormaResumoView; tipos: string[] }>();
  for (const r of itens) {
    const g = m.get(r.norma.id) ?? { norma: r.norma, tipos: [] };
    g.tipos.push(REL_LABEL[r.tipo]);
    m.set(r.norma.id, g);
  }
  return [...m.values()].map((g) => ({ norma: g.norma, tipos: g.tipos.join(', ') }));
}
