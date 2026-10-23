import { Injectable, ServiceUnavailableException } from '@nestjs/common';

const VALIDADE_MS = 24 * 60 * 60_000;

/**
 * Municipios por UF da API do IBGE, com cache em memoria (24 h): a lista quase
 * nunca muda e o cadastro de orgao nao pode depender do IBGE estar no ar.
 */
@Injectable()
export class IbgeService {
  private readonly cache = new Map<string, { ate: number; dados: Array<{ id: number; nome: string }> }>();

  async municipios(uf: string): Promise<Array<{ id: number; nome: string }>> {
    const em = this.cache.get(uf);
    if (em && em.ate > Date.now()) return em.dados;
    try {
      const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const dados = ((await res.json()) as Array<{ id: number; nome: string }>).map((m) => ({ id: m.id, nome: m.nome }));
      this.cache.set(uf, { ate: Date.now() + VALIDADE_MS, dados });
      return dados;
    } catch {
      // IBGE fora do ar: usa a ultima lista conhecida, mesmo vencida.
      if (em) return em.dados;
      throw new ServiceUnavailableException('Não foi possível consultar os municípios no IBGE agora');
    }
  }
}
