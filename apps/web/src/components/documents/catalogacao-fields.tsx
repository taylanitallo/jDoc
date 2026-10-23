'use client';

import { DADOS_PESSOAIS, DADOS_PESSOAIS_LABEL } from '@jdoc/shared';
import { inputCls, labelCls, SelectMenu } from '@/components/ui';

/** Chaves que este bloco edita (o modal de edicao manda vazio como "apagar"). */
export const CAMPOS_CATALOGACAO = ['numero', 'assunto', 'interessado', 'palavrasChave', 'dadosPessoais'] as const;

/**
 * Metadados padrao do dicionario (numero, assunto, interessado, palavras-chave)
 * e a marcacao LGPD de dados pessoais. Mesmo contrato de valores dos outros
 * blocos do modal: string por chave, vazio = nao informado.
 */
export function CatalogacaoFields({
  values,
  onChange,
  atual,
  idPrefix,
}: {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  atual?: { numero: string | null; assunto: string | null; interessado: string | null; palavrasChave: string[]; dadosPessoais: string };
  idPrefix: string;
}) {
  const v = (k: (typeof CAMPOS_CATALOGACAO)[number], atualValor: string) => values[k] ?? atualValor;
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="sm:col-span-2 rounded-[16px] border border-ink-200 p-3">
      <p className="mb-2 label-caps">Catalogação</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor={id('numero')}>
            Número
          </label>
          <input
            id={id('numero')}
            className={inputCls}
            maxLength={60}
            placeholder="ex.: 123/2026"
            value={v('numero', atual?.numero ?? '')}
            onChange={(e) => onChange('numero', e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor={id('interessado')}>
            Interessado
          </label>
          <input
            id={id('interessado')}
            className={inputCls}
            maxLength={300}
            placeholder="Pessoa, empresa ou setor"
            value={v('interessado', atual?.interessado ?? '')}
            onChange={(e) => onChange('interessado', e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor={id('assunto')}>
            Assunto
          </label>
          <input
            id={id('assunto')}
            className={inputCls}
            maxLength={500}
            placeholder="Resumo do conteúdo (ementa, objeto)"
            value={v('assunto', atual?.assunto ?? '')}
            onChange={(e) => onChange('assunto', e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor={id('palavrasChave')}>
            Palavras-chave
          </label>
          <input
            id={id('palavrasChave')}
            className={inputCls}
            placeholder="separadas por vírgula"
            value={v('palavrasChave', (atual?.palavrasChave ?? []).join(', '))}
            onChange={(e) => onChange('palavrasChave', e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor={id('dadosPessoais')}>
            Dados pessoais (LGPD)
          </label>
          <SelectMenu
            id={id('dadosPessoais')}
            className={inputCls}
            value={v('dadosPessoais', atual?.dadosPessoais ?? 'nao')}
            onChange={(e) => onChange('dadosPessoais', e.target.value)}
          >
            {DADOS_PESSOAIS.map((d) => (
              <option key={d} value={d}>
                {DADOS_PESSOAIS_LABEL[d]}
              </option>
            ))}
          </SelectMenu>
          {v('dadosPessoais', atual?.dadosPessoais ?? 'nao') === 'sensiveis' && (
            <p className="mt-1.5 text-xs text-ink-500">Saúde, biometria, religião, opinião política etc. Prefira nível de acesso restrito.</p>
          )}
        </div>
      </div>
    </div>
  );
}
