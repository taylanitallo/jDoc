'use client';

import type { CampoMetadado, Metadados } from '@jdoc/shared';
import { inputCls, labelCls, SelectMenu } from '@/components/ui';

/** Renderiza os campos de metadados definidos no Tipo de Documento (Acervo). */
export function MetadadosFields({
  campos,
  values,
  onChange,
  idPrefix = 'md',
}: {
  campos: readonly CampoMetadado[];
  values: Metadados;
  onChange: (next: Metadados) => void;
  idPrefix?: string;
}) {
  if (campos.length === 0) return null;
  const set = (chave: string, v: string) => onChange({ ...values, [chave]: v });

  return (
    <>
      {campos.map((c) => {
        const id = `${idPrefix}-${c.chave}`;
        const value = values[c.chave] ?? '';
        const largo = c.tipo === 'texto_longo';
        return (
          <div key={c.chave} className={largo ? 'sm:col-span-2' : undefined}>
            <label className={labelCls} htmlFor={id}>
              {c.rotulo}
              {c.obrigatorio && <span className="ml-0.5 text-danger-600">*</span>}
            </label>
            {c.tipo === 'texto_longo' ? (
              <textarea id={id} rows={3} className={inputCls} value={value} onChange={(e) => set(c.chave, e.target.value)} />
            ) : c.tipo === 'selecao' ? (
              <SelectMenu id={id} className={inputCls} value={value} onChange={(e) => set(c.chave, e.target.value)}>
                <option value="">— Selecione —</option>
                {(c.opcoes ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </SelectMenu>
            ) : (
              <input
                id={id}
                className={inputCls}
                type={c.tipo === 'data' ? 'date' : 'text'}
                inputMode={c.tipo === 'numero' ? 'decimal' : undefined}
                value={value}
                onChange={(e) => set(c.chave, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** Metadados do Decreto 10.278/2020 para documento digitalizado. */
export function DigitalizacaoFields({
  values,
  onChange,
  idPrefix = 'dg',
}: {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  idPrefix?: string;
}) {
  const ativo = values.digitalizado === 'true';
  return (
    <div className="sm:col-span-2 rounded-[16px] border border-ink-200 p-3">
      <label className="flex items-center gap-2 text-sm text-ink-800">
        <input
          type="checkbox"
          checked={ativo}
          onChange={(e) => onChange('digitalizado', e.target.checked ? 'true' : 'false')}
        />
        Documento digitalizado a partir de original em papel (Decreto 10.278/2020)
      </label>
      {ativo && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor={`${idPrefix}-resp`}>Responsável pela digitalização</label>
            <input id={`${idPrefix}-resp`} className={inputCls} value={values.responsavelDigitalizacao ?? ''} onChange={(e) => onChange('responsavelDigitalizacao', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${idPrefix}-data`}>Data da digitalização</label>
            <input id={`${idPrefix}-data`} type="date" className={inputCls} value={values.dataDigitalizacao ?? ''} onChange={(e) => onChange('dataDigitalizacao', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor={`${idPrefix}-local`}>Local da digitalização</label>
            <input id={`${idPrefix}-local`} className={inputCls} value={values.localDigitalizacao ?? ''} onChange={(e) => onChange('localDigitalizacao', e.target.value)} placeholder="ex.: Arquivo Municipal — Sala de digitalização" />
          </div>
        </div>
      )}
    </div>
  );
}
