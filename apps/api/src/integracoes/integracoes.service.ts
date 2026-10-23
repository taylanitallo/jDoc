import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import {
  DEFINICOES_INTEGRACAO,
  INTEGRACOES,
  type IntegracaoKey,
  type IntegracaoUpdateInput,
  type IntegracaoView,
  type OrigemIntegracao,
  type TesteIntegracao,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { loadEnv } from '../config/env';
import { cifrar, decifrar, mascarar } from '../common/crypto';

type Config = Record<string, string | number | null>;
type SegredosCifrados = Record<string, string>;

interface Linha {
  enabled: boolean;
  usar_padrao?: boolean;
  config: Config;
  credentials_encrypted: SegredosCifrados;
  updated_at: Date;
}

/** Configuracao efetiva de uma integracao, com os segredos ja decifrados (so para uso interno). */
export interface IntegracaoResolvida {
  origem: OrigemIntegracao;
  config: Config;
  segredos: Record<string, string>;
}

const TIMEOUT_TESTE_MS = 10_000;

/**
 * Integracoes do sistema. Ordem de resolucao: chave propria do orgao ->
 * padrao da plataforma (Superadmin > Configuracoes) -> variavel de ambiente
 * (compatibilidade com o que ja rodava so por env).
 */
@Injectable()
export class IntegracoesService {
  private readonly logger = new Logger(IntegracoesService.name);

  constructor(private readonly db: DatabaseService) {}

  static validarKey(key: string): IntegracaoKey {
    if (!(INTEGRACOES as readonly string[]).includes(key)) throw new BadRequestException('Integração desconhecida');
    return key as IntegracaoKey;
  }

  private decifrarTodos(c: SegredosCifrados): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(c ?? {})) {
      try {
        out[k] = decifrar(v);
      } catch (e) {
        this.logger.error(`Segredo ${k} ilegivel: ${(e as Error).message}`);
      }
    }
    return out;
  }

  private doAmbiente(key: IntegracaoKey): IntegracaoResolvida | null {
    const env = loadEnv();
    if (key === 'ia_gemini' && env.GEMINI_API_KEY) return { origem: 'ambiente', config: {}, segredos: { apiKey: env.GEMINI_API_KEY } };
    if (key === 'ia_anthropic' && env.ANTHROPIC_API_KEY) return { origem: 'ambiente', config: {}, segredos: { apiKey: env.ANTHROPIC_API_KEY } };
    return null;
  }

  private async plataforma(key: IntegracaoKey): Promise<Linha | undefined> {
    const [l] = await this.db.catalog()<Linha[]>`
      SELECT enabled, config, credentials_encrypted, updated_at FROM platform.settings WHERE key = ${key}
    `;
    return l;
  }

  private async doOrgao(tenantId: string, key: IntegracaoKey): Promise<Linha | undefined> {
    const [l] = await this.db.catalog()<Linha[]>`
      SELECT enabled, usar_padrao, config, credentials_encrypted, updated_at
      FROM platform.tenant_integrations WHERE tenant_id = ${tenantId} AND key = ${key}
    `;
    return l;
  }

  /** Configuracao que vale de fato (null = integracao indisponivel). */
  async resolver(tenantId: string | null, key: IntegracaoKey): Promise<IntegracaoResolvida | null> {
    if (tenantId) {
      const o = await this.doOrgao(tenantId, key);
      if (o && !o.usar_padrao) {
        return o.enabled ? { origem: 'orgao', config: o.config, segredos: this.decifrarTodos(o.credentials_encrypted) } : null;
      }
    }
    const p = await this.plataforma(key);
    if (p) return p.enabled ? { origem: 'plataforma', config: p.config, segredos: this.decifrarTodos(p.credentials_encrypted) } : null;
    return this.doAmbiente(key);
  }

  private visao(key: IntegracaoKey, linha: Linha | undefined, extra: Partial<IntegracaoView>): IntegracaoView {
    const segredos: Record<string, string | null> = {};
    const claros = linha ? this.decifrarTodos(linha.credentials_encrypted) : {};
    for (const s of DEFINICOES_INTEGRACAO[key].segredos) segredos[s.id] = mascarar(claros[s.id]);
    return {
      key,
      enabled: linha?.enabled ?? false,
      usarPadrao: linha?.usar_padrao ?? true,
      config: linha?.config ?? {},
      segredos,
      origemEfetiva: null,
      padraoDisponivel: false,
      atualizadoEm: linha?.updated_at.toISOString() ?? null,
      ...extra,
    };
  }

  async listarPlataforma(): Promise<IntegracaoView[]> {
    return Promise.all(
      INTEGRACOES.map(async (key) => {
        const p = await this.plataforma(key);
        const efetiva = await this.resolver(null, key);
        return this.visao(key, p, { usarPadrao: false, origemEfetiva: efetiva?.origem ?? null, padraoDisponivel: !!efetiva });
      }),
    );
  }

  async listarOrgao(tenantId: string): Promise<IntegracaoView[]> {
    return Promise.all(
      INTEGRACOES.map(async (key) => {
        const o = await this.doOrgao(tenantId, key);
        const efetiva = await this.resolver(tenantId, key);
        const padrao = await this.resolver(null, key);
        return this.visao(key, o, { origemEfetiva: efetiva?.origem ?? null, padraoDisponivel: !!padrao });
      }),
    );
  }

  /** Mescla segredos: ausente mantem, null apaga, texto novo substitui (cifrado). */
  private mesclarSegredos(key: IntegracaoKey, atuais: SegredosCifrados, novos: IntegracaoUpdateInput['segredos']): SegredosCifrados {
    const permitidos = new Set(DEFINICOES_INTEGRACAO[key].segredos.map((s) => s.id));
    const out: SegredosCifrados = { ...(atuais ?? {}) };
    for (const [id, valor] of Object.entries(novos ?? {})) {
      if (!permitidos.has(id)) throw new BadRequestException(`Campo secreto desconhecido: ${id}`);
      if (valor === null || valor === '') delete out[id];
      else out[id] = cifrar(valor);
    }
    return out;
  }

  private limparConfig(key: IntegracaoKey, config: Config): Config {
    const permitidos = new Set(DEFINICOES_INTEGRACAO[key].campos.map((c) => c.id));
    return Object.fromEntries(Object.entries(config).filter(([k]) => permitidos.has(k)));
  }

  /** Grava e devolve antes/depois sem segredos (para a auditoria). */
  async salvarPlataforma(key: IntegracaoKey, input: IntegracaoUpdateInput, adminId: string): Promise<{ antes: unknown; depois: unknown }> {
    const atual = await this.plataforma(key);
    const config = this.limparConfig(key, input.config);
    const segredos = this.mesclarSegredos(key, atual?.credentials_encrypted ?? {}, input.segredos);
    const sql = this.db.catalog();
    await sql`
      INSERT INTO platform.settings (key, enabled, config, credentials_encrypted, updated_by, updated_at)
      VALUES (${key}, ${input.enabled}, ${sql.json(config)}, ${sql.json(segredos)}, ${adminId}, now())
      ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, config = EXCLUDED.config,
        credentials_encrypted = EXCLUDED.credentials_encrypted, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    return {
      antes: atual ? { ligado: atual.enabled, ...atual.config, segredos: Object.keys(atual.credentials_encrypted ?? {}) } : null,
      depois: { ligado: input.enabled, ...config, segredos: Object.keys(segredos) },
    };
  }

  async salvarOrgao(
    tenantId: string,
    key: IntegracaoKey,
    input: IntegracaoUpdateInput,
    adminId: string,
  ): Promise<{ antes: unknown; depois: unknown }> {
    const atual = await this.doOrgao(tenantId, key);
    const usarPadrao = input.usarPadrao ?? true;
    const config = this.limparConfig(key, input.config);
    const segredos = this.mesclarSegredos(key, atual?.credentials_encrypted ?? {}, input.segredos);
    const sql = this.db.catalog();
    await sql`
      INSERT INTO platform.tenant_integrations (tenant_id, key, enabled, usar_padrao, config, credentials_encrypted, updated_by, updated_at)
      VALUES (${tenantId}, ${key}, ${input.enabled}, ${usarPadrao}, ${sql.json(config)}, ${sql.json(segredos)}, ${adminId}, now())
      ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = EXCLUDED.enabled, usar_padrao = EXCLUDED.usar_padrao,
        config = EXCLUDED.config, credentials_encrypted = EXCLUDED.credentials_encrypted,
        updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    const resumo = (l: { enabled: boolean; usar_padrao?: boolean; config: Config; credentials_encrypted: SegredosCifrados }) => ({
      ligado: l.enabled,
      usarPadrao: l.usar_padrao,
      ...l.config,
      segredos: Object.keys(l.credentials_encrypted ?? {}),
    });
    return {
      antes: atual ? resumo(atual) : null,
      depois: resumo({ enabled: input.enabled, usar_padrao: usarPadrao, config, credentials_encrypted: segredos }),
    };
  }

  /** "Testar conexao": usa a configuracao efetiva (do orgao ou a padrao). */
  async testar(tenantId: string | null, key: IntegracaoKey): Promise<TesteIntegracao> {
    const inicio = Date.now();
    const r = await this.resolver(tenantId, key);
    if (!r) return { ok: false, mensagem: 'Integração desligada ou sem configuração.', ms: 0 };
    try {
      const mensagem = await this.executarTeste(key, r);
      return { ok: true, mensagem, ms: Date.now() - inicio };
    } catch (e) {
      return { ok: false, mensagem: (e as Error).message, ms: Date.now() - inicio };
    }
  }

  private async executarTeste(key: IntegracaoKey, r: IntegracaoResolvida): Promise<string> {
    const s = r.segredos;
    const get = async (url: string, headers: Record<string, string> = {}): Promise<Response> => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_TESTE_MS) });
      if (res.status === 401 || res.status === 403) throw new Error('Chave recusada pelo provedor (sem permissão).');
      if (!res.ok) throw new Error(`O provedor respondeu com erro ${res.status}.`);
      return res;
    };
    switch (key) {
      case 'email_smtp': {
        const t = criarTransporteSmtp(r);
        await t.verify();
        t.close();
        return 'Servidor de e-mail aceitou a conexão e o login.';
      }
      case 'ia_gemini':
        if (!s.apiKey) throw new Error('Chave de API não informada.');
        await get(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(s.apiKey)}`);
        return 'Chave do Gemini válida.';
      case 'ia_anthropic':
        if (!s.apiKey) throw new Error('Chave de API não informada.');
        await get('https://api.anthropic.com/v1/models', { 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01' });
        return 'Chave da Anthropic válida.';
      case 'mapas': {
        if (!s.apiKey) throw new Error('Chave de API não informada.');
        if (r.config.provedor === 'mapbox') {
          await get(`https://api.mapbox.com/geocoding/v5/mapbox.places/Fortaleza.json?limit=1&access_token=${encodeURIComponent(s.apiKey)}`);
        } else {
          const res = await get(`https://maps.googleapis.com/maps/api/geocode/json?address=Fortaleza&key=${encodeURIComponent(s.apiKey)}`);
          const body = (await res.json()) as { status?: string; error_message?: string };
          if (body.status && body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
            throw new Error(`Google Maps recusou a chave (${body.status}).`);
          }
        }
        return 'Chave de mapas válida.';
      }
      case 'whatsapp': {
        if (!s.token || !r.config.phoneNumberId) throw new Error('Informe o identificador do número e o token.');
        await get(`https://graph.facebook.com/v21.0/${encodeURIComponent(String(r.config.phoneNumberId))}`, {
          Authorization: `Bearer ${s.token}`,
        });
        return 'WhatsApp Business conectado.';
      }
    }
  }
}

/** Transporte SMTP a partir de uma configuracao resolvida (usado tambem pelo envio de e-mail). */
export function criarTransporteSmtp(r: IntegracaoResolvida): nodemailer.Transporter {
  const porta = Number(r.config.porta ?? 587);
  const seguranca = String(r.config.seguranca ?? 'starttls');
  if (!r.config.host) throw new Error('Informe o servidor SMTP.');
  return nodemailer.createTransport({
    host: String(r.config.host),
    port: porta,
    secure: seguranca === 'ssl',
    requireTLS: seguranca === 'starttls',
    ignoreTLS: seguranca === 'nenhuma',
    auth: r.config.usuario ? { user: String(r.config.usuario), pass: r.segredos.senha ?? '' } : undefined,
    connectionTimeout: TIMEOUT_TESTE_MS,
    greetingTimeout: TIMEOUT_TESTE_MS,
    socketTimeout: 20_000,
  });
}
