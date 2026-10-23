import type { EtapaLote } from '@jdoc/shared';
import type { Tone } from '@/components/ui';

/** Cor do selo de cada etapa do lote (lista, detalhe e producao). */
export const ETAPA_TOM: Record<EtapaLote, Tone> = {
  recebido: 'neutral',
  preparacao: 'info',
  digitalizacao: 'brand',
  indexacao: 'teal',
  controle_qualidade: 'warning',
  disponibilizado: 'success',
  devolvido: 'violet',
};
