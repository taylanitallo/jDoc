'use client';

import { SISTEMAS, SISTEMA_LABEL, type Sistema } from '@jdoc/shared';
import { Badge, labelCls } from '@/components/ui';

const DESCRICAO: Record<Sistema, string> = {
  financeiro: 'Receitas, despesas, balancete, extrato, prestação de contas, mídia legislativa, etiquetas SS/ASPEC/JBS.',
  arquivo: 'Acervo, plano de classificação, temporalidade, eliminação legal e arquivo físico.',
};

/** Checkboxes dos modulos contratados pelo orgao (ao menos um). */
export function ModulosContratados({
  value,
  onChange,
  erro,
}: {
  value: Sistema[];
  onChange: (v: Sistema[]) => void;
  erro?: string;
}) {
  const alternar = (s: Sistema) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <div className="col-span-2">
      <p className={labelCls}>Módulos contratados<span className="ml-0.5 text-danger-600">*</span></p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SISTEMAS.map((s) => (
          <label
            key={s}
            className={`flex cursor-pointer gap-2 rounded-[10px] border p-3 text-sm transition ${
              value.includes(s) ? 'border-accent bg-ink-50' : 'border-ink-200'
            }`}
          >
            <input type="checkbox" checked={value.includes(s)} onChange={() => alternar(s)} className="mt-0.5" />
            <span>
              <span className="font-semibold text-ink-800">{SISTEMA_LABEL[s]}</span>
              <span className="block text-xs text-ink-500">{DESCRICAO[s]}</span>
            </span>
          </label>
        ))}
      </div>
      {value.length === 2 && (
        <p className="mt-1 text-xs text-ink-500">Com os dois módulos, os documentos financeiros também recebem classificação e temporalidade.</p>
      )}
      {(erro || value.length === 0) && <p className="mt-1 text-xs text-danger-600">{erro ?? 'Selecione ao menos um módulo'}</p>}
    </div>
  );
}

export function ModulosBadges({ modulos }: { modulos: Sistema[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {modulos.map((m) => (
        <Badge key={m} color={m === 'arquivo' ? 'orange' : 'blue'}>
          {SISTEMA_LABEL[m]}
        </Badge>
      ))}
    </span>
  );
}
