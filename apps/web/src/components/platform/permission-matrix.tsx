'use client';

import { Fragment } from 'react';
import {
  ACAO_LABEL,
  MODULE_ACTIONS,
  PERMISSAO_LABEL,
  acoesDoModulo,
  linhasPermissao,
  type ModuleAction,
  type ModuleName,
  type Sistema,
} from '@jdoc/shared';
import { cn } from '@/lib/cn';

/**
 * Matriz de permissoes: linhas = modulos (agrupados por sistema), colunas =
 * Ver, Criar, Editar, Excluir, Exportar. Clicar no nome da linha ou da coluna
 * marca/desmarca tudo dela.
 */
export function PermissionMatrix({
  value,
  onChange,
  sistemas,
  readOnly,
}: {
  value: string[];
  onChange?: (v: string[]) => void;
  sistemas?: readonly Sistema[];
  readOnly?: boolean;
}) {
  const marcadas = new Set(value);
  const grupos = linhasPermissao(sistemas);
  const todasVisiveis = grupos.flatMap((g) => g.modulos.flatMap((m) => acoesDoModulo(m).map((a) => `${m}:${a}`)));

  const definir = (chaves: string[], ligar: boolean) => {
    if (readOnly || !onChange) return;
    const s = new Set(value);
    for (const c of chaves) {
      if (ligar) s.add(c);
      else s.delete(c);
    }
    onChange([...s].sort());
  };
  const alternarGrupo = (chaves: string[]) => definir(chaves, !chaves.every((c) => marcadas.has(c)));

  const linha = (m: ModuleName) => acoesDoModulo(m).map((a) => `${m}:${a}`);
  const coluna = (a: ModuleAction) => todasVisiveis.filter((c) => c.endsWith(`:${a}`));

  return (
    <div className="overflow-x-auto rounded-[12px] border border-ink-200">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-ink-200 bg-ink-50/60">
          <tr>
            <th className="px-3 py-2.5 text-left label-caps">Módulo</th>
            {MODULE_ACTIONS.map((a) => (
              <th key={a} className="w-20 px-2 py-2.5 text-center">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => alternarGrupo(coluna(a))}
                  className="label-caps transition enabled:hover:text-brand-600"
                  title={readOnly ? undefined : `Marcar ou desmarcar "${ACAO_LABEL[a]}" em tudo`}
                >
                  {ACAO_LABEL[a]}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <Fragment key={g.grupo}>
              <tr className="bg-ink-50/40">
                <td colSpan={MODULE_ACTIONS.length + 1} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-500">
                  {g.grupo}
                </td>
              </tr>
              {g.modulos.map((m) => {
                const acoes = acoesDoModulo(m);
                return (
                  <tr key={m} className="border-t border-ink-100">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => alternarGrupo(linha(m))}
                        className="text-left font-semibold text-ink-800 transition enabled:hover:text-brand-600"
                      >
                        {PERMISSAO_LABEL[m].label}
                      </button>
                      {PERMISSAO_LABEL[m].dica && <span className="block text-xs text-ink-500">{PERMISSAO_LABEL[m].dica}</span>}
                    </td>
                    {MODULE_ACTIONS.map((a) => {
                      const chave = `${m}:${a}`;
                      if (!acoes.includes(a)) {
                        return (
                          <td key={a} className="px-2 py-2 text-center text-ink-300" aria-hidden>
                            —
                          </td>
                        );
                      }
                      const on = marcadas.has(chave);
                      return (
                        <td key={a} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={readOnly}
                            onChange={() => definir([chave], !on)}
                            aria-label={`${ACAO_LABEL[a]} em ${PERMISSAO_LABEL[m].label}`}
                            className={cn('h-4 w-4 rounded border-ink-300 accent-brand-600', readOnly && 'opacity-70')}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
