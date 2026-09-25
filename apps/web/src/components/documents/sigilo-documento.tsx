'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, ShieldAlert } from 'lucide-react';
import {
  GRAUS_SIGILO,
  GRAU_SIGILO_LABEL,
  HIPOTESES_SIGILO,
  PRAZO_SIGILO_ANOS,
  prazoFimSigilo,
  type ClassificarSigiloInput,
  type GrauSigilo,
  type HipoteseSigilo,
  type TermoSigiloView,
  hojeIso,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Field, Input, Modal, SelectMenu, Textarea, inputCls, type Tone } from '@/components/ui';
import { useToast } from '@/components/toast';

export const GRAU_TOM: Record<GrauSigilo, Tone> = { reservado: 'warning', secreto: 'orange', ultrassecreto: 'danger', pessoal: 'violet' };
const br = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');

/**
 * Bloco "Sigilo (LAI)" na edicao do documento: mostra o termo vigente ou permite
 * classificar. Sem permissao sigilo:read a consulta falha e o bloco some.
 */
export function SigiloDocumento({ slug, documentId, dataDocumento }: { slug: string; documentId: string; dataDocumento: string | null }) {
  const [aberto, setAberto] = useState(false);
  const { data: termos, isError } = useQuery<TermoSigiloView[]>({
    queryKey: ['sigilo', 'documento', slug, documentId],
    queryFn: () => api(`/t/${slug}/sigilo/termos?situacao=vigentes&documentId=${documentId}`),
    retry: false,
  });
  if (isError || !termos) return null;
  const vigente = termos[0];

  return (
    <div className="rounded-[12px] border border-ink-200/70 p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <ShieldAlert className="h-4 w-4 text-danger-600" aria-hidden />
          Sigilo (Lei de Acesso à Informação)
        </p>
        {!vigente && (
          <Button size="sm" variant="outline" leftIcon={<Lock aria-hidden />} onClick={() => setAberto(true)}>
            Classificar sigilo
          </Button>
        )}
      </div>
      {vigente ? (
        <div className="mt-2 space-y-1 text-xs text-ink-600">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={GRAU_TOM[vigente.grau]}>{GRAU_SIGILO_LABEL[vigente.grau]}</Badge>
            <span>
              {vigente.numeroTci} · até {br(vigente.prazoFim)}
            </span>
          </p>
          <p>{vigente.fundamento}</p>
          <p>
            Autoridade: {vigente.autoridadeNome} — {vigente.autoridadeCargo}
          </p>
          <p className="text-ink-400">Para liberar o acesso antes do prazo, use a desclassificação na tela Sigilo.</p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-ink-500">Sem classificação de sigilo. Classifique se a informação se enquadrar no art. 23 ou for informação pessoal (art. 31).</p>
      )}
      {aberto && <ClassificarSigiloModal slug={slug} documentId={documentId} dataDocumento={dataDocumento} onClose={() => setAberto(false)} />}
    </div>
  );
}

function ClassificarSigiloModal({ slug, documentId, dataDocumento, onClose }: { slug: string; documentId: string; dataDocumento: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [grau, setGrau] = useState<GrauSigilo>('reservado');
  const [hipotese, setHipotese] = useState<HipoteseSigilo>('art23_VIII');
  const [complemento, setComplemento] = useState('');
  const [razoes, setRazoes] = useState('');
  const [autoridadeNome, setAutoridadeNome] = useState('');
  const [autoridadeCargo, setAutoridadeCargo] = useState('');
  const [dataProducao, setDataProducao] = useState(dataDocumento ?? '');
  const [prazoFim, setPrazoFim] = useState('');

  const hipoteses = HIPOTESES_SIGILO.filter((h) => (grau === 'pessoal' ? h.codigo === 'art31' : h.codigo !== 'art31'));
  const maximo = useMemo(() => (/^\d{4}-\d{2}-\d{2}$/.test(dataProducao) ? prazoFimSigilo(dataProducao, grau) : null), [dataProducao, grau]);
  const jaVencido = maximo !== null && maximo <= hojeIso();

  const salvar = useMutation({
    mutationFn: () => {
      const body: ClassificarSigiloInput = {
        grau,
        hipotese,
        razoes: razoes.trim(),
        autoridadeNome: autoridadeNome.trim(),
        autoridadeCargo: autoridadeCargo.trim(),
        ...(complemento.trim() ? { fundamentoComplemento: complemento.trim() } : {}),
        ...(dataProducao ? { dataProducao } : {}),
        ...(prazoFim ? { prazoFim } : {}),
      };
      return api<TermoSigiloView>(`/t/${slug}/sigilo/documentos/${documentId}/classificar`, { method: 'POST', body });
    },
    onSuccess: (t) => {
      toast.success(`${t.numeroTci} registrado. O documento agora é restrito até ${br(t.prazoFim)}.`);
      qc.invalidateQueries({ queryKey: ['sigilo'] });
      qc.invalidateQueries({ queryKey: ['docs'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para classificar sigilo.' : e.message) : 'Falha ao classificar'),
  });

  return (
    <Modal
      open
      size="lg"
      onClose={() => !salvar.isPending && onClose()}
      title="Classificar sigilo"
      subtitle="Gera o Termo de Classificação de Informação (Decreto nº 7.724/2012)"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button variant="danger" leftIcon={<Lock aria-hidden />} onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={jaVencido}>
            Classificar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Grau" htmlFor="sg-grau" required hint={`Prazo máximo: ${PRAZO_SIGILO_ANOS[grau]} anos da produção`}>
          <SelectMenu
            id="sg-grau"
            className={inputCls}
            value={grau}
            onChange={(e) => {
              const g = e.target.value as GrauSigilo;
              setGrau(g);
              setHipotese(g === 'pessoal' ? 'art31' : 'art23_VIII');
            }}
          >
            {GRAUS_SIGILO.map((g) => (
              <option key={g} value={g}>
                {GRAU_SIGILO_LABEL[g]} ({PRAZO_SIGILO_ANOS[g]} anos)
              </option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Data de produção do documento" htmlFor="sg-prod" required hint="O prazo conta desta data (art. 24, § 1º)">
          <Input id="sg-prod" type="date" value={dataProducao} onChange={(e) => setDataProducao(e.target.value)} />
        </Field>
        <Field label="Hipótese legal" htmlFor="sg-hip" required className="sm:col-span-2">
          <SelectMenu id="sg-hip" className={inputCls} value={hipotese} onChange={(e) => setHipotese(e.target.value as HipoteseSigilo)}>
            {hipoteses.map((h) => (
              <option key={h.codigo} value={h.codigo}>{h.texto}</option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Complemento do fundamento" htmlFor="sg-comp" className="sm:col-span-2" hint="Ex.: outra lei específica, número do processo">
          <Input id="sg-comp" value={complemento} onChange={(e) => setComplemento(e.target.value)} />
        </Field>
        <Field label="Razões da classificação" htmlFor="sg-raz" required className="sm:col-span-2" hint="Específicas: por que a divulgação traria o risco apontado (art. 28, II)">
          <Textarea id="sg-raz" rows={3} value={razoes} onChange={(e) => setRazoes(e.target.value)} />
        </Field>
        <Field label="Autoridade classificadora" htmlFor="sg-aut" required>
          <Input id="sg-aut" value={autoridadeNome} onChange={(e) => setAutoridadeNome(e.target.value)} placeholder="Nome" />
        </Field>
        <Field label="Cargo" htmlFor="sg-cargo" required hint={grau === 'ultrassecreto' ? 'Ultrassecreto: prefeito, vice ou autoridade equivalente' : undefined}>
          <Input id="sg-cargo" value={autoridadeCargo} onChange={(e) => setAutoridadeCargo(e.target.value)} placeholder="Ex.: Prefeito Municipal" />
        </Field>
        <Field label="Prazo final (opcional)" htmlFor="sg-prazo" hint={maximo ? `Máximo: ${br(maximo)}. Deixe em branco para usar o máximo.` : undefined}>
          <Input id="sg-prazo" type="date" value={prazoFim} max={maximo ?? undefined} onChange={(e) => setPrazoFim(e.target.value)} />
        </Field>
        {jaVencido && (
          <p className="flex items-start gap-2 rounded-[10px] bg-warning-50 px-3 py-2 text-xs text-warning-600 sm:col-span-2">
            <LockOpen className="mt-px h-4 w-4 shrink-0" aria-hidden />O prazo máximo deste grau já venceu em {br(maximo!)}: a informação já é pública. Escolha um grau com prazo maior, se couber.
          </p>
        )}
      </div>
    </Modal>
  );
}
