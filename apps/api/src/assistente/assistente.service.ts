import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
// @google/genai e ESM-only (package.json "type":"module") — so tipo aqui
// (apagado na compilacao, nunca vira require()); a classe real e importada
// via import() dinamico dentro de ensureClient(), unico lugar onde e
// instanciada (mesmo padrao usado em conferencia.worker.ts).
import type {
  Content,
  FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
} from '@google/genai' with { 'resolution-mode': 'import' };
import { z } from 'zod';
import {
  DOC_MODULES,
  DOC_SUBTYPES,
  type AssistenteResposta,
  type DocumentView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { PrivacidadeService } from '../privacidade/privacidade.service';
import { DocumentsService } from '../documents/documents.service';
import { BuscaService } from '../ocr/busca.service';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';

/** Teto de idas-e-voltas de tool-use por pergunta — controla custo e evita loop infinito. */
const MAX_TURNOS = 4;
const LIMITE_PADRAO = 20;
const LIMITE_TETO = 50;

/** 429 (RESOURCE_EXHAUSTED) e 503 (UNAVAILABLE) sao transitorios — comuns no
 *  plano gratuito do Gemini sob demanda alta; vale a pena tentar de novo. */
const STATUS_TRANSITORIO = new Set([429, 503]);
const MAX_TENTATIVAS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusDoErro(e: unknown): number | null {
  return e instanceof Error && 'status' in e && typeof (e as { status: unknown }).status === 'number'
    ? (e as { status: number }).status
    : null;
}

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

/** JSON Schema puro (Tool.parametersJsonSchema) — mesmo formato entre provedores, sem depender do enum Type do SDK. */
const CONSULTAR_TOOL_PARAMS = {
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
} as const;

const CONSULTAR_TOOL: FunctionDeclaration = {
  name: 'consultar_documentos',
  description:
    'Consulta os documentos (etiquetas) de um modulo (despesas, receitas, balancete, extrato ou outros) do orgao publico, com filtros opcionais e agregacao (soma/contagem/media do campo valor). Use pra responder qualquer pergunta sobre valores, quantidades ou listas de documentos — nunca invente numeros sem chamar essa ferramenta. Pode chamar mais de uma vez (ex: um modulo por vez, ou refinando o filtro) antes da resposta final.',
  parametersJsonSchema: CONSULTAR_TOOL_PARAMS,
};

const buscaConteudoInputSchema = z
  .object({
    texto: z.string().min(2).max(200),
    modulo: z.enum(DOC_MODULES).optional(),
  })
  .strict();

const BUSCAR_CONTEUDO_TOOL: FunctionDeclaration = {
  name: 'buscar_conteudo',
  description:
    'Procura palavras DENTRO do texto dos PDFs (inclusive escaneados, via OCR) — ex.: "qual lei trata do plano diretor", "contrato da reforma da escola X", "portaria que nomeou Fulano". Devolve os documentos mais relevantes com titulo, pagina e trecho. Use quando a pergunta depender do conteudo do documento e nao so de campos como valor/credor.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Palavras-chave (sem acento tudo bem); frase exata entre aspas' },
      modulo: { type: 'string', enum: [...DOC_MODULES], description: 'Opcional: restringe a um modulo' },
    },
    required: ['texto'],
  },
};

@Injectable()
export class AssistenteService {
  private readonly logger = new Logger(AssistenteService.name);
  private gemini: GoogleGenAI | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly busca: BuscaService,
    private readonly privacidade: PrivacidadeService,
  ) {}

  /** Se a feature esta configurada (API key presente) neste ambiente. */
  isEnabled(): boolean {
    return !!loadEnv().GEMINI_API_KEY;
  }

  private async ensureClient(): Promise<GoogleGenAI | null> {
    const env = loadEnv();
    if (!env.GEMINI_API_KEY) return null;
    if (!this.gemini) {
      const { GoogleGenAI } = await import('@google/genai');
      this.gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    }
    return this.gemini;
  }

  async perguntar(user: TenantAccessClaims, pergunta: string): Promise<AssistenteResposta> {
    const client = await this.ensureClient();
    if (!client) {
      throw new ForbiddenException('Assistente de busca por IA nao esta configurado neste ambiente.');
    }
    if (await this.privacidade.iaDesligada()) {
      throw new ForbiddenException('O órgão desligou o uso de inteligência artificial com os documentos.');
    }
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const orgaos = await sql<Array<{ id: string; codigo: string; descricao: string }>>`
      SELECT id, codigo, descricao FROM orgaos WHERE deleted_at IS NULL AND ativo = true ORDER BY codigo
    `;
    const orgaosTexto = orgaos.length
      ? orgaos.map((o) => `- ${o.id}: ${o.codigo} — ${o.descricao}`).join('\n')
      : '(nenhum orgao cadastrado)';

    const systemPrompt = `Voce e um assistente que responde perguntas em portugues sobre os documentos de uma prefeitura (financeiros — despesas, receitas, balancetes, extratos, outros — e o acervo do Arquivo Municipal: leis, decretos, portarias, contratos etc.). Ferramentas: consultar_documentos (campos, valores, contagens) e buscar_conteudo (palavras dentro do texto dos PDFs).

Regras:
- Sempre use a ferramenta pra buscar dados reais antes de responder — nunca invente numeros.
- Uma pergunta pode exigir mais de uma chamada (ex: modulos diferentes, ou refinar o filtro).
- Depois de ter os dados, responda em portugues claro e direto, citando os valores/quantidades encontrados.
- Se nao encontrar nada, diga isso claramente — nunca invente um resultado.
- Perguntas sobre o que o documento DIZ (assunto, nome citado, objeto do contrato, ementa) usam buscar_conteudo; cite titulo e pagina.
- Se a busca no conteudo nao achar nada, diga isso — pode ser documento ainda nao indexado.

Órgãos cadastrados (use o ID exato ao filtrar por órgão):
${orgaosTexto}

Exercício atual, se a pergunta não especificar o ano: ${new Date().getFullYear()}`;

    const documentosCitados = new Map<string, DocumentView>();
    const avisos: string[] = [];
    const contents: Content[] = [{ role: 'user', parts: [{ text: pergunta }] }];

    try {
      return await this.executarLoop(client, contents, systemPrompt, pergunta, user, documentosCitados, avisos);
    } catch (e) {
      const status = statusDoErro(e);
      this.logger.error(`Falha ao consultar o Gemini: ${e instanceof Error ? e.message : String(e)}`);
      return {
        resposta:
          status && STATUS_TRANSITORIO.has(status)
            ? 'O Gemini está sobrecarregado agora (comum no plano gratuito em horários de pico) — tente novamente em alguns instantes.'
            : 'Não consegui consultar a IA agora. Tente novamente em instantes.',
        documentos: [...documentosCitados.values()],
        avisos,
      };
    }
  }

  /** Chama generateContent com retry curto pra 429/503 (transitorios no plano gratuito). */
  private async gerarComRetry(client: GoogleGenAI, contents: Content[], systemPrompt: string): Promise<GenerateContentResponse> {
    let ultimoErro: unknown;
    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      try {
        return await client.models.generateContent({
          model: 'gemini-flash-latest',
          contents,
          config: {
            systemInstruction: systemPrompt,
            tools: [{ functionDeclarations: [CONSULTAR_TOOL, BUSCAR_CONTEUDO_TOOL] }],
          },
        });
      } catch (e) {
        ultimoErro = e;
        const status = statusDoErro(e);
        const ultimaTentativa = tentativa === MAX_TENTATIVAS - 1;
        if (!status || !STATUS_TRANSITORIO.has(status) || ultimaTentativa) throw e;
        await sleep(500 * 2 ** tentativa);
      }
    }
    throw ultimoErro;
  }

  private async executarLoop(
    client: GoogleGenAI,
    contents: Content[],
    systemPrompt: string,
    pergunta: string,
    user: TenantAccessClaims,
    documentosCitados: Map<string, DocumentView>,
    avisos: string[],
  ): Promise<AssistenteResposta> {
    for (let turno = 0; turno < MAX_TURNOS; turno++) {
      const response = await this.gerarComRetry(client, contents, systemPrompt);

      // Usa os parts BRUTOS da resposta (nao o getter response.functionCalls,
      // que descarta o thoughtSignature) — o Gemini exige que esse campo seja
      // ecoado de volta exatamente como veio quando a functionCall entra no
      // historico de um turno seguinte, senao rejeita com 400.
      const rawParts = response.candidates?.[0]?.content?.parts ?? [];
      const functionCalls = rawParts
        .filter((p): p is Part & { functionCall: NonNullable<Part['functionCall']> } => !!p.functionCall)
        .map((p) => p.functionCall);

      if (functionCalls.length === 0) {
        return {
          resposta: response.text || 'Não consegui gerar uma resposta. Tente reformular a pergunta.',
          documentos: [...documentosCitados.values()],
          avisos,
        };
      }

      contents.push({ role: 'model', parts: rawParts });

      const responseParts: Part[] = [];
      for (const fc of functionCalls) {
        if (fc.name === BUSCAR_CONTEUDO_TOOL.name) {
          responseParts.push(await this.executarBuscaConteudo(user, fc, documentosCitados, avisos));
          continue;
        }
        const parsed = consultaInputSchema.safeParse(fc.args);
        if (!parsed.success) {
          responseParts.push({
            functionResponse: { id: fc.id, name: fc.name, response: { error: `Filtro invalido: ${parsed.error.message}` } },
          });
          continue;
        }
        const { modulo, agregacao, limite, ...filtros } = parsed.data;
        try {
          const resultado = await this.documents.consultarAgregado(user, modulo, filtros, agregacao, limite);
          for (const doc of resultado.documentos) documentosCitados.set(doc.id, doc);
          responseParts.push({
            functionResponse: {
              id: fc.id,
              name: fc.name,
              response: {
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
              },
            },
          });
        } catch (e) {
          const msg = e instanceof ForbiddenException ? 'Sem permissao pra consultar esse modulo.' : 'Erro ao consultar.';
          avisos.push(`${modulo}: ${msg}`);
          responseParts.push({ functionResponse: { id: fc.id, name: fc.name, response: { error: msg } } });
        }
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    this.logger.warn(`Pergunta nao concluida em ${MAX_TURNOS} turnos: "${pergunta}"`);
    return this.respostaIncompleta(documentosCitados, avisos);
  }

  /** Mesmo RBAC/nivel de acesso da tela de busca: BuscaService filtra por modulos legiveis e restrito. */
  private async executarBuscaConteudo(
    user: TenantAccessClaims,
    fc: NonNullable<Part['functionCall']>,
    documentosCitados: Map<string, DocumentView>,
    avisos: string[],
  ): Promise<Part> {
    const parsed = buscaConteudoInputSchema.safeParse(fc.args);
    if (!parsed.success) {
      return { functionResponse: { id: fc.id, name: fc.name, response: { error: `Parametros invalidos: ${parsed.error.message}` } } };
    }
    try {
      const r = await this.busca.buscar(user, { q: parsed.data.texto, module: parsed.data.modulo, page: 1, pageSize: 8 });
      for (const it of r.items.slice(0, 5)) {
        const doc = await this.documents.get(user, it.documentId).catch(() => null);
        if (doc) documentosCitados.set(doc.id, doc);
      }
      return {
        functionResponse: {
          id: fc.id,
          name: fc.name,
          response: {
            total: r.total,
            resultados: r.items.map((it) => ({
              id: it.documentId,
              titulo: it.titulo,
              modulo: it.module,
              data: it.documentDate,
              pagina: it.pagina,
              trecho: it.trecho.map((s) => s.texto).join(''),
            })),
          },
        },
      };
    } catch {
      avisos.push('Busca no conteudo indisponivel.');
      return { functionResponse: { id: fc.id, name: fc.name, response: { error: 'Erro ao buscar no conteudo.' } } };
    }
  }

  private respostaIncompleta(documentosCitados: Map<string, DocumentView>, avisos: string[]): AssistenteResposta {
    return {
      resposta: 'Não consegui concluir a consulta a tempo — tente uma pergunta mais específica.',
      documentos: [...documentosCitados.values()],
      avisos,
    };
  }
}
