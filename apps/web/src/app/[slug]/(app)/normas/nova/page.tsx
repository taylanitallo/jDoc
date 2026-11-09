'use client';

import { useMemo, useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, Plus, Scale, UploadCloud, X } from 'lucide-react';
import { TIPOS_NORMA, TIPO_NORMA_LABEL, type DocumentTypeLookup, type Metadados, type TipoNorma } from '@jdoc/shared';
import { api, renovarSessao } from '@/lib/api';
import { uploadDocument } from '@/lib/upload';
import { Button, Card, CardHeader, Field, Input, SelectMenu, Switch, Textarea, TONE_VIVID, formatBytes, inputCls } from '@/components/ui';
import { MetadadosFields } from '@/components/documents/metadados-fields';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

/** Nome do tipo documental do Acervo que corresponde a cada tipo de norma. */
const TIPO_ACERVO: Record<TipoNorma, RegExp[]> = {
  lei: [/\blei\b(?!.*(complementar|org[aâ]nica))/i, /\blei\b/i],
  lei_complementar: [/complementar/i, /\blei\b(?!.*org[aâ]nica)/i],
  decreto: [/decreto/i],
  portaria: [/portaria/i],
  resolucao: [/resolu/i],
  emenda_lom: [/emenda/i],
  lei_organica: [/org[aâ]nica/i, /\blei\b/i],
  outro: [],
};

function tipoDoAcervo(tipos: DocumentTypeLookup[], tipo: TipoNorma): DocumentTypeLookup | undefined {
  for (const re of TIPO_ACERVO[tipo]) {
    const t = tipos.find((x) => re.test(x.nome));
    if (t) return t;
  }
  return undefined;
}

/** Campos do tipo do Acervo que a propria norma ja preenche. */
const CHAVES_DA_NORMA = new Set(['numero', 'data_publicacao', 'ementa', 'assunto', 'especie']);

export default function NovaNormaPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState({ tipo: 'lei' as TipoNorma, numero: '', ano: '', dataPublicacao: '', ementa: '' });
  const [publicada, setPublicada] = useState(true);
  const [nivelAcesso, setNivelAcesso] = useState<'publico' | 'restrito'>('publico');
  const [tipoManual, setTipoManual] = useState('');
  const [extras, setExtras] = useState<Metadados>({});
  const [file, setFile] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);

  const { data: tipos = [], isLoading: carregandoTipos } = useQuery<DocumentTypeLookup[]>({
    queryKey: ['document-types', slug, 'acervo'],
    queryFn: () => api(`/t/${slug}/document-types?modulo=acervo`),
  });
  const automatico = useMemo(() => tipoDoAcervo(tipos, meta.tipo), [tipos, meta.tipo]);
  const tipoAcervo = automatico ?? tipos.find((t) => t.id === tipoManual);
  const camposExtras = (tipoAcervo?.campos ?? []).filter((c) => !CHAVES_DA_NORMA.has(c.chave));

  const anoValido = /^\d{4}$/.test(meta.ano);
  const faltaExtra = camposExtras.some((c) => c.obrigatorio && !extras[c.chave]?.trim());
  const valido = !!file && !!tipoAcervo && meta.numero.trim() && anoValido && meta.ementa.trim().length >= 3 && !faltaExtra;

  const escolher = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Envie o PDF da norma.');
      return;
    }
    setFile(f);
  };
  const soltar = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    escolher(e.dataTransfer.files[0]);
  };

  const enviar = async () => {
    if (!valido || !tipoAcervo || !file) return;
    const numero = meta.numero.trim();
    const ementa = meta.ementa.trim();
    const metadados: Metadados = {};
    for (const c of tipoAcervo.campos) {
      if (c.chave === 'numero') metadados.numero = numero;
      else if (c.chave === 'ementa' || c.chave === 'assunto') metadados[c.chave] = ementa;
      else if (c.chave === 'data_publicacao') {
        if (meta.dataPublicacao) metadados.data_publicacao = meta.dataPublicacao;
      } else if (c.chave === 'especie' && c.tipo === 'selecao') {
        const esp = meta.tipo === 'lei_complementar' ? 'Complementar' : meta.tipo === 'lei' ? 'Ordinária' : null;
        if (esp && c.opcoes?.includes(esp)) metadados.especie = esp;
      } else if (extras[c.chave]?.trim()) metadados[c.chave] = extras[c.chave]!.trim();
    }
    const campos: Record<string, string> = {
      module: 'acervo',
      documentTypeId: tipoAcervo.id,
      descricao: ementa,
      documentDate: meta.dataPublicacao || `${meta.ano}-01-01`,
      exercicio: meta.ano,
      nivelAcesso,
      numero,
      metadados: JSON.stringify(metadados),
    };
    setProgresso(0);
    let r = await uploadDocument(slug, campos, file, setProgresso);
    if (!r.ok && r.status === 401 && (await renovarSessao())) r = await uploadDocument(slug, campos, file, setProgresso);
    if (!r.ok) {
      setProgresso(null);
      toast.error(r.status === 403 ? 'Você não tem permissão para incluir documentos no Acervo.' : r.message);
      return;
    }
    const id = (r.body as { id: string }).id;
    const q = new URLSearchParams({ publicada: publicada ? '1' : '0', tipo: meta.tipo, ano: meta.ano });
    router.push(`/${slug}/normas/estruturar/${id}?${q.toString()}`);
  };

  return (
    <div className="space-y-6">
      <Link href={`/${slug}/normas`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Legislação
      </Link>
      <div className="flex min-w-0 items-start gap-4">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.brand.chip)}>
          <Plus className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Nova norma</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Envie o PDF e preencha os dados uma vez só. O PDF fica guardado no Acervo e o texto vai para a Legislação.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader title="Dados da norma" icon={Scale} />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Tipo" htmlFor="n-tipo" required>
            <SelectMenu id="n-tipo" className={inputCls} value={meta.tipo} onChange={(e) => setMeta({ ...meta, tipo: e.target.value as TipoNorma })}>
              {TIPOS_NORMA.map((t) => (
                <option key={t} value={t}>{TIPO_NORMA_LABEL[t]}</option>
              ))}
            </SelectMenu>
          </Field>
          <Field label="Número" htmlFor="n-num" required>
            <Input id="n-num" value={meta.numero} onChange={(e) => setMeta({ ...meta, numero: e.target.value })} placeholder="1.234" />
          </Field>
          <Field label="Data de publicação" htmlFor="n-data">
            <Input
              id="n-data"
              type="date"
              value={meta.dataPublicacao}
              onChange={(e) => setMeta({ ...meta, dataPublicacao: e.target.value, ano: e.target.value ? e.target.value.slice(0, 4) : meta.ano })}
            />
          </Field>
          <Field label="Ano" htmlFor="n-ano" required>
            <Input id="n-ano" inputMode="numeric" value={meta.ano} onChange={(e) => setMeta({ ...meta, ano: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </Field>
          <Field label="Ementa" htmlFor="n-ementa" required className="sm:col-span-2 xl:col-span-4">
            <Textarea id="n-ementa" rows={2} value={meta.ementa} onChange={(e) => setMeta({ ...meta, ementa: e.target.value })} />
          </Field>
          <Field label="Acesso ao documento" htmlFor="n-acesso" required>
            <SelectMenu id="n-acesso" className={inputCls} value={nivelAcesso} onChange={(e) => setNivelAcesso(e.target.value as 'publico' | 'restrito')}>
              <option value="publico">Público</option>
              <option value="restrito">Restrito</option>
            </SelectMenu>
          </Field>
          <label className="flex items-center gap-3 pt-6 text-sm sm:col-span-1 xl:col-span-3">
            <Switch checked={publicada} onChange={setPublicada} label="Publicar no portal" />
            <span>
              <span className="block font-semibold text-ink-800">Publicar no portal</span>
              <span className="block text-xs text-ink-500">Só aparece no portal se o acesso for público</span>
            </span>
          </label>
          {!carregandoTipos && !automatico && (
            <Field
              label="Tipo no Acervo"
              htmlFor="n-tipo-acervo"
              required
              className="sm:col-span-2"
              hint={tipos.length === 0 ? 'Nenhum tipo do Acervo cadastrado. Crie em Configurações → Tipos de Documento.' : `Nenhum tipo do Acervo com o nome “${TIPO_NORMA_LABEL[meta.tipo]}”. Escolha onde guardar o PDF.`}
            >
              <SelectMenu id="n-tipo-acervo" className={inputCls} value={tipoManual} onChange={(e) => setTipoManual(e.target.value)}>
                <option value="" disabled>Selecione…</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </SelectMenu>
            </Field>
          )}
          <MetadadosFields campos={camposExtras} values={extras} onChange={setExtras} idPrefix="nova-md" />
        </div>
      </Card>

      <Card>
        <CardHeader title="PDF publicado" icon={FileText} description="O documento oficial. O sistema lê o texto do PDF para separar os artigos." />
        <div className="p-5">
          {file ? (
            <div className="flex items-center gap-3 rounded-[12px] border border-ink-200 px-4 py-3">
              <FileText className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">{file.name}</p>
                <p className="text-xs text-ink-500">{formatBytes(file.size)}</p>
              </div>
              {progresso === null && (
                <button type="button" title="Remover" onClick={() => setFile(null)} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastando(true);
              }}
              onDragLeave={() => setArrastando(false)}
              onDrop={soltar}
              className={cn(
                'flex w-full flex-col items-center gap-2 rounded-[14px] border-2 border-dashed px-6 py-10 text-center transition-colors',
                arrastando ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50',
              )}
            >
              <UploadCloud className="h-8 w-8 text-ink-400" aria-hidden />
              <span className="text-sm font-semibold text-ink-800">Arraste o PDF aqui ou clique para escolher</span>
            </button>
          )}
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => escolher(e.target.files?.[0])} />
          {progresso !== null && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${progresso}%` }} />
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-ink-100 px-5 py-3">
          <Button leftIcon={<UploadCloud aria-hidden />} loading={progresso !== null} disabled={!valido} onClick={enviar}>
            Enviar e estruturar o texto
          </Button>
        </div>
      </Card>
    </div>
  );
}
