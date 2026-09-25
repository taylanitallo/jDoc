'use client';

import { useQuery } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import {
  calcularPrazos,
  classeTemTemporalidade,
  type ClassificacaoPadraoPorModulo,
  type ClassificacaoView,
  type DocModule,
  type UsuarioAtual,
} from '@jdoc/shared';
import { api } from '@/lib/api';
import { inputCls, labelCls, SelectMenu } from '@/components/ui';

const fmt = (iso: string | null): string =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—';

/**
 * Campos de gestao arquivistica nos modais de documento: classe do Plano de
 * Classificacao, nivel de acesso e (evento manual) inicio da contagem, com
 * preview dos prazos calculados pela mesma funcao usada no servidor.
 *
 * Emite so chaves preenchidas: string vazia = remove a chave (classe vazia na
 * inclusao = classe padrao do modulo, decidida no servidor).
 */
export function ClassificacaoFields({
  slug,
  module,
  values,
  onChange,
  documentDate,
  exercicio,
  atual,
  padrao: padraoTipo,
  sigiloVigente = false,
}: {
  slug: string;
  module: DocModule;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  documentDate: string | null;
  exercicio: number | null;
  /** Na edicao: valores atuais do documento. */
  atual?: {
    classificacaoId: string | null;
    nivelAcesso: string;
    dataInicioContagem: string | null;
  };
  /** Padrao vindo do Tipo de Documento (Acervo) — prevalece sobre o padrao do modulo. */
  padrao?: { classificacaoId: string | null; nivelAcesso: string; origem: 'tipo' };
  /** Sigilo LAI vigente: o acesso so muda pela desclassificacao. */
  sigiloVigente?: boolean;
}) {
  const { data: classes } = useQuery<ClassificacaoView[]>({
    queryKey: ['arquivistica', 'classificacoes'],
    queryFn: () => api(`/t/${slug}/arquivistica/classificacoes`),
    staleTime: 60_000,
  });
  // mesma chave do layout: vem do cache, sem nova requisicao
  const { data: usuario } = useQuery<UsuarioAtual>({
    queryKey: ['auth', 'me', slug],
    queryFn: () => api(`/t/${slug}/auth/me`),
    staleTime: 5 * 60_000,
  });
  // Acervo nasce restrito (o servidor aplica o mesmo padrao); financeiro segue publico.
  const nivel =
    values.nivelAcesso ?? atual?.nivelAcesso ?? padraoTipo?.nivelAcesso ?? (module === 'acervo' ? 'restrito' : 'publico');
  const { data: padroes } = useQuery<ClassificacaoPadraoPorModulo>({
    queryKey: ['arquivistica', 'padroes'],
    queryFn: () => api(`/t/${slug}/arquivistica/padroes`),
    staleTime: 60_000,
  });

  const utilizaveis = (classes ?? []).filter((c) => c.ativo && classeTemTemporalidade(c));
  if (!classes) return null;
  // Plano ainda nao configurado: so o nivel de acesso aparece.
  const temPlano = classes.length > 0;

  const padraoId =
    padraoTipo?.classificacaoId ??
    (padroes as Record<string, string | null | undefined> | undefined)?.[module] ??
    null;
  const selecionadaId =
    values.classificacaoId ?? atual?.classificacaoId ?? (atual ? null : padraoId);
  const classe = classes.find((c) => c.id === selecionadaId) ?? null;
  const inicioManual = values.dataInicioContagem ?? atual?.dataInicioContagem ?? null;
  const prazos = classe
    ? calcularPrazos(classe, { documentDate, exercicio, dataInicioManual: inicioManual })
    : null;
  const padrao = classes.find((c) => c.id === padraoId);

  return (
    <div className="sm:col-span-2 rounded-[16px] border border-ink-200 p-3">
      <p className="mb-2 label-caps">Gestão arquivística</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {temPlano && (
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="classificacaoId">
              Classificação
            </label>
            <SelectMenu
              id="classificacaoId"
              className={inputCls}
              value={values.classificacaoId ?? atual?.classificacaoId ?? ''}
              onChange={(e) => onChange('classificacaoId', e.target.value)}
            >
              <option value="">
                {atual
                  ? '— Selecione —'
                  : padrao
                    ? `Padrão do ${padraoTipo ? 'tipo' : 'módulo'} (${padrao.codigo} — ${padrao.descricao})`
                    : '— Sem classificação —'}
              </option>
              {utilizaveis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} — {c.descricao}
                </option>
              ))}
            </SelectMenu>
          </div>
        )}
        <div>
          <label className={labelCls} htmlFor="nivelAcesso">
            Nível de acesso
          </label>
          <SelectMenu
            id="nivelAcesso"
            className={inputCls}
            value={sigiloVigente ? 'restrito' : nivel}
            disabled={sigiloVigente}
            onChange={(e) => onChange('nivelAcesso', e.target.value)}
          >
            <option value="restrito">Restrito (dados pessoais/sigilo)</option>
            <option value="publico">Público</option>
          </SelectMenu>
          {sigiloVigente && <p className="mt-1.5 text-xs text-ink-500">Travado pela classificação de sigilo (LAI).</p>}
          {nivel === 'restrito' && usuario && !usuario.podeVerRestrito && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-warning-600" role="note">
              <EyeOff className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              Você não tem acesso a documentos restritos: depois de salvar, este documento não aparecerá para você. Escolha
              Público se ele puder ser consultado por todos.
            </p>
          )}
        </div>
        {classe?.eventoContagem === 'manual' && (
          <div>
            <label className={labelCls} htmlFor="dataInicioContagem">
              Início da contagem
            </label>
            <input
              id="dataInicioContagem"
              type="date"
              className={inputCls}
              value={inicioManual ?? ''}
              onChange={(e) => onChange('dataInicioContagem', e.target.value)}
            />
          </div>
        )}
      </div>
      {classe && (
        <p className="mt-2 text-xs text-ink-500">
          {prazos?.dataPrevistaDestinacao ? (
            <>
              Transferência prevista: <strong>{fmt(prazos.dataPrevistaTransferencia)}</strong> ·
              Destinação ({classe.destinacao === 'eliminacao' ? 'eliminação' : 'guarda permanente'}
              ): <strong>{fmt(prazos.dataPrevistaDestinacao)}</strong>
            </>
          ) : (
            'Prazos serão calculados quando o evento de início da contagem for informado.'
          )}
        </p>
      )}
    </div>
  );
}
