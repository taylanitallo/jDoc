import { useEffect, useState } from 'react';
import type { BudgetUnit, DocumentType, LookupKind } from './types';

export interface LookupOption {
  value: string;
  label: string;
}

interface LookupsState {
  loading: boolean;
  error: string | null;
  optionsFor: (kind: LookupKind) => LookupOption[];
}

/**
 * Carrega os lookups (unidades orcamentarias + tipos de documento) uma vez ao
 * montar a tela de upload. O cache real vive no main (60s); aqui so guardamos
 * o resultado com estado de loading/erro para os selects.
 */
export function useLookups(): LookupsState {
  const [budgetUnits, setBudgetUnits] = useState<BudgetUnit[]>([]);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [bu, dt] = await Promise.all([
          window.jdoc.invoke('lookup:budget-units') as Promise<BudgetUnit[]>,
          window.jdoc.invoke('lookup:document-types') as Promise<DocumentType[]>,
        ]);
        if (alive) {
          setBudgetUnits(bu);
          setDocumentTypes(dt);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Falha ao carregar listas');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function optionsFor(kind: LookupKind): LookupOption[] {
    if (kind === 'budget-units') {
      return budgetUnits.map((b) => ({ value: b.id, label: b.codigo ? `${b.codigo} — ${b.nome}` : b.nome }));
    }
    return documentTypes.map((d) => ({ value: d.id, label: d.nome }));
  }

  return { loading, error, optionsFor };
}
