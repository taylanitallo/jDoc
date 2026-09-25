'use client';

import { useQuery } from '@tanstack/react-query';
import { UFS } from '@jdoc/shared';
import { inputCls, labelCls, SelectMenu } from '@/components/ui';

const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** Municipios da UF pela API publica do IBGE (lista oficial, com acentos). */
async function municipios(uf: string): Promise<string[]> {
  const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`);
  if (!r.ok) throw new Error('IBGE indisponível');
  const dados = (await r.json()) as Array<{ nome: string }>;
  return dados.map((m) => m.nome);
}

/**
 * UF primeiro, depois a cidade (lista do IBGE). Se o IBGE nao responder, a cidade vira
 * campo de texto livre para nao travar o cadastro.
 */
export function UfCidadeFields({
  uf,
  cidade,
  onUf,
  onCidade,
  idPrefix,
  obrigatorio = false,
  erroUf,
  erroCidade,
}: {
  uf: string;
  cidade: string;
  onUf: (uf: string) => void;
  onCidade: (cidade: string) => void;
  idPrefix: string;
  obrigatorio?: boolean;
  erroUf?: string;
  erroCidade?: string;
}) {
  const { data: lista, isLoading, isError } = useQuery({
    queryKey: ['ibge', 'municipios', uf],
    queryFn: () => municipios(uf),
    enabled: uf.length === 2,
    staleTime: Infinity,
    retry: 1,
  });
  // Cidade gravada antes (texto livre) que nao bate com o IBGE continua visivel para correcao.
  const opcoes = lista && cidade && !lista.includes(cidade) ? [cidade, ...lista] : (lista ?? []);
  const req = obrigatorio ? <span className="ml-0.5 text-danger-600">*</span> : null;

  return (
    <>
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-uf`}>
          UF{req}
        </label>
        <SelectMenu
          id={`${idPrefix}-uf`}
          className={inputCls}
          value={uf}
          onChange={(e) => {
            onUf(e.target.value);
            onCidade('');
          }}
        >
          <option value="">Selecione o estado…</option>
          {UFS.map((u) => (
            <option key={u} value={u}>
              {u} — {UF_NOME[u] ?? u}
            </option>
          ))}
        </SelectMenu>
        {erroUf && <p className="mt-1 text-xs text-danger-600">{erroUf}</p>}
      </div>
      <div>
        <label className={labelCls} htmlFor={`${idPrefix}-cidade`}>
          Cidade{req}
        </label>
        {isError ? (
          <input id={`${idPrefix}-cidade`} className={inputCls} value={cidade} onChange={(e) => onCidade(e.target.value)} placeholder="Digite a cidade" />
        ) : (
          <SelectMenu
            id={`${idPrefix}-cidade`}
            className={inputCls}
            value={cidade}
            disabled={!uf || isLoading}
            onChange={(e) => onCidade(e.target.value)}
          >
            <option value="">{!uf ? 'Selecione a UF primeiro' : isLoading ? 'Carregando municípios…' : 'Selecione a cidade…'}</option>
            {opcoes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </SelectMenu>
        )}
        {isError && <p className="mt-1 text-xs text-warning-600">Lista do IBGE indisponível agora: digite o nome.</p>}
        {erroCidade && <p className="mt-1 text-xs text-danger-600">{erroCidade}</p>}
      </div>
    </>
  );
}
