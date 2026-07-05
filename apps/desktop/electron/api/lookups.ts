import { apiGet } from './client';

/**
 * Lookups do upload (unidades orcamentarias e tipos de documento) com cache
 * de 60s no MAIN. Reduz idas ao backend ao reabrir a tela de upload.
 * Chave de cache por slug + tipo.
 */
export interface BudgetUnit {
  id: string;
  codigo: string | null;
  nome: string;
}

export interface DocumentType {
  id: string;
  nome: string;
  cor: string;
}

const TTL_MS = 60_000;

interface CacheEntry<T> {
  at: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.value as T;
  }
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function budgetUnits(slug: string): Promise<BudgetUnit[]> {
  return cached(`bu:${slug}`, () => apiGet<BudgetUnit[]>(`/t/${slug}/budget-units`));
}

export function documentTypes(slug: string): Promise<DocumentType[]> {
  return cached(`dt:${slug}`, () => apiGet<DocumentType[]>(`/t/${slug}/document-types`));
}
