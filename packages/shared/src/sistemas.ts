import { z } from 'zod';
import type { DocModule } from './documents.js';

/**
 * Sistemas contrataveis por orgao (ligados/desligados pelo superadmin):
 * - financeiro: GED financeiro/contabil (receitas, despesas, balancete, extrato,
 *   outros, prestacao de contas, midia legislativa, etiquetas SS/ASPEC/JBS, conferencia IA)
 * - arquivo: Arquivo Municipal (acervo, plano de classificacao, temporalidade,
 *   eliminacao, arquivo fisico)
 * Comuns aos dois: busca no conteudo, assistente IA, copia autenticada/verificacao,
 * configuracoes, usuarios e auditoria.
 *
 * Com os dois ligados ficam integrados: documentos financeiros recebem
 * classificacao/temporalidade do Arquivo.
 */
export const SISTEMAS = ['financeiro', 'arquivo'] as const;
export const sistemaSchema = z.enum(SISTEMAS);
export type Sistema = z.infer<typeof sistemaSchema>;

export const SISTEMA_LABEL: Record<Sistema, string> = {
  financeiro: 'Financeiro/Contábil',
  arquivo: 'Arquivo Municipal',
};

export const sistemasSchema = z
  .array(sistemaSchema)
  .min(1, 'Selecione ao menos um módulo contratado')
  .transform((s) => [...new Set(s)].sort() as Sistema[]);

/** Modulo de documento -> sistema dono. */
export function sistemaDoModulo(m: DocModule): Sistema {
  return m === 'acervo' ? 'arquivo' : 'financeiro';
}

/** Modulos RBAC (MODULES) que pertencem a cada sistema — a tela de permissoes so mostra os contratados. */
export const MODULOS_RBAC_POR_SISTEMA: Record<Sistema, readonly string[]> = {
  financeiro: ['receitas', 'despesas', 'balancete', 'extrato', 'outros', 'prestacao_contas', 'midia_legislativa', 'unidades_orcamentarias', 'projetos_atividades', 'elementos_despesa'],
  arquivo: ['acervo', 'acervo_restrito', 'acervo_sigiloso', 'classificacao', 'temporalidade', 'arquivo_fisico', 'integridade', 'atendimento', 'sigilo', 'dossies', 'descricao', 'legislacao', 'digitalizacao', 'fiscal_contrato'],
};

export function temSistema(sistemas: readonly string[] | undefined, s: Sistema): boolean {
  return (sistemas ?? []).includes(s);
}
