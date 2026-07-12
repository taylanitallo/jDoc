import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  DOC_MODULES,
  DOC_SUBTYPES,
  type AssistenteResposta,
  type DocumentView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';

/** Teto de idas-e-voltas de tool-use por pergunta — controla custo e evita loop infinito. */
const MAX_TURNOS = 4;
const LIMITE_PADRAO = 20;
const LIMITE_TETO = 50;

/**
 * O que a IA pode pedir pra ferramenta consultar_documentos — espelha os
 * filtros de SearchDocumentsQuery (menos module/page/pageSize/sort, que sao
 * fixados pelo service), mais agregacao e limite. `.strict()` + validado com
 * zod ANTES de chegar no banco — nunca confia cegamente no que o modelo manda.
 */
const consultaInputSchema = z
  .object({
    modulo: z.enum(DOC_MODULES),
    subtype: z.enum(DOC_SUBTYPES).optional(),
    exercicio: z.number().int().min(2000).max(2100).optional(),
    competencia: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    orgaoId: z.string().uuid().optional(),
    credor: z.string().max(200).optional(),
    empenho: z.string().max(60).optional(),
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    valorMin: z.number().nonnegative().optional(),
    valorMax: z.number().nonnegative().optional(),
    comArquivo: z.enum(['sim', 'nao']).optional(),
    critica: z.enum(['sim', 'nao']).optional(),
    agregacao: z.enum(['soma_valor', 'contagem', 'media_valor', 'nenhuma']).default('nenhuma'),
    limite: z.number().int().min(1).max(LIMITE_TETO).default(LIMITE_PADRAO),
  })
  .strict();

const CONSULTAR_TOOL: Anthropic.Tool = {
  name: 'consultar_documentos',
  description:
    'Consulta os documentos (etiquetas) de um modulo (despesas, receitas, balancete, extrato ou outros) do orgao publico, com filtros opcionais e agregacao (soma/contagem/media do campo valor). Use pra responder qualquer pergunta sobre valores, quantidades ou listas de documentos — nunca invente numeros sem chamar essa ferramenta. Pode chamar mais de uma vez (ex: um modulo por vez, ou refinando o filtro) antes da resposta final.',
  input_schema: {
    type: 'object',
    properties: {
      modulo: { type: 'string', enum: [...DOC_MODULES], description: 'Modulo de documento a consultar' },
      subtype: { type: 'string', enum: [...DOC_SUBTYPES] },
      exercicio: { type: 'integer', description: 'Ano do exercicio financeiro, ex: 2026' },
      competencia: { type: 'string', description: 'Competencia no formato AAAA-MM' },
      orgaoId: { type: 'string', description: 'UUID do orgao — use a lista de orgaos do prompt pra achar o ID pelo nome' },
      credor: { type: 'string', description: 'Nome (ou parte) do credor/fornecedor' },
      empenho: { type: 'string' },
      de: { type: 'string', description: 'Data inicial, formato AAAA-MM-DD' },
      ate: { type: 'string', description: 'Data final, formato AAAA-MM-DD' },
      valorMin: { type: 'number' },
      valorMax: { type: 'number' },
      comArquivo: { type: 'string', enum: ['sim', 'nao'], description: 'Filtra por ter (sim) ou nao ter (nao) PDF anexado' },
      critica: { type: 'string', enum: ['sim', 'nao'], description: 'sim = so documentos com divergencia/falha na conferencia por IA' },
      agregacao: { type: 'string', enum: ['soma_valor', 'contagem', 'media_valor', 'nenhuma'] },
      limite: { type: 'integer', description: `Max de documentos a retornar como fonte (padrao ${LIMITE_PADRAO}, teto ${LIMITE_TETO})` },
    },
    required: ['modulo'],
  },
};

@Injectable()
export class AssistenteService {
  private readonly logger = new Logger(AssistenteService.name);
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly db: DatabaseService,
    private readonly documents: DocumentsService,
  ) {
    const env = loadEnv();
    this.anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  }

  /** Se a feature esta configurada (API key presente) neste ambiente. */
  isEnabled(): boolean {
    return this.anthropic !== null;
  }

  async perguntar(user: TenantAccessClaims, pergunta: string): Promise<AssistenteResposta> {
    if (!this.anthropic) {
      throw new ForbiddenException('Assistente de busca por IA nao esta configurado neste ambiente.');
    }
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const orgaos = await sql<Array<{ id: string; codigo: string; descricao: string }>>`
      SELECT id, codigo, descricao FROM orgaos WHERE deleted_at IS NULL AND ativo = true ORDER BY codigo
    `;
    const orgaosTexto = orgaos.length
      ? orgaos.map((o) => `- ${o.id}: ${o.codigo} — ${o.descricao}`).join('\n')
      : '(nenhum orgao cadastrado)';

    const systemPrompt = `Voce e um assistente que responde perguntas em portugues sobre os documentos financeiros (despesas, receitas, balancetes, extratos e outros) de uma prefeitura, usando a ferramenta consultar_documentos.

Regras:
- Sempre use a ferramenta pra buscar dados reais antes de responder — nunca invente numeros.
- Uma pergunta pode exigir mais de uma chamada (ex: modulos diferentes, ou refinar o filtro).
- Depois de ter os dados, responda em portugues claro e direto, citando os valores/quantidades encontrados.
- Se nao encontrar nada, diga isso claramente — nunca invente um resultado.
- Se a pergunta pedir algo fora do que a ferramenta cobre (ex: o conteudo do texto dentro do PDF), explique a limitacao.

Órgãos cadastrados (use o ID exato ao filtrar por órgão):
${orgaosTexto}

Exercício atual, se a pergunta não especificar o ano: ${new Date().getFullYear()}`;

    const documentosCitados = new Map<string, DocumentView>();
    const avisos: string[] = [];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: pergunta }];

    for (let turno = 0; turno < MAX_TURNOS; turno++) {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        tools: [CONSULTAR_TOOL],
        messages,
      });

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');

      if (toolUses.length === 0) {
        return {
          resposta: textBlock?.text || 'Não consegui gerar uma resposta. Tente reformular a pergunta.',
          documentos: [...documentosCitados.values()],
          avisos,
        };
      }

      // Reconstroi so os blocos que de fato mandamos de volta (texto + tool_use)
      // em vez de reenviar response.content bruto — evita blocos exoticos
      // (thinking, server tools) que nao pedimos e que o Param nao aceita.
      const assistantContent: Anthropic.ContentBlockParam[] = response.content
        .filter((b): b is Anthropic.TextBlock | Anthropic.ToolUseBlock => b.type === 'text' || b.type === 'tool_use')
        .map((b) =>
          b.type === 'text'
            ? { type: 'text' as const, text: b.text }
            : { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input },
        );
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const parsed = consultaInputSchema.safeParse(toolUse.input);
        if (!parsed.success) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Filtro invalido: ${parsed.error.message}`,
            is_error: true,
          });
          continue;
        }
        const { modulo, agregacao, limite, ...filtros } = parsed.data;
        try {
          const resultado = await this.documents.consultarAgregado(user, modulo, filtros, agregacao, limite);
          for (const doc of resultado.documentos) documentosCitados.set(doc.id, doc);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              agregado: resultado.agregado,
              totalDocumentosRetornados: resultado.documentos.length,
              documentos: resultado.documentos.slice(0, 10).map((d) => ({
                id: d.id,
                docCaixa: d.docCaixa,
                credor: d.credor,
                valor: d.value,
                data: d.documentDate,
                conferenciaStatus: d.conferenciaStatus,
              })),
            }),
          });
        } catch (e) {
          const msg = e instanceof ForbiddenException ? 'Sem permissao pra consultar esse modulo.' : 'Erro ao consultar.';
          avisos.push(`${modulo}: ${msg}`);
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: msg, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    this.logger.warn(`Pergunta nao concluida em ${MAX_TURNOS} turnos: "${pergunta}"`);
    return {
      resposta: 'Não consegui concluir a consulta a tempo — tente uma pergunta mais específica.',
      documentos: [...documentosCitados.values()],
      avisos,
    };
  }
}
