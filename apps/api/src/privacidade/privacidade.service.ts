import { Injectable } from '@nestjs/common';
import {
  LGPD_PLATAFORMA_PADRAO,
  lgpdPlataformaSchema,
  privacidadeOrgaoSchema,
  type LgpdPlataforma,
  type PrivacidadeOrgao,
  type PrivacidadePublica,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';

/** Chave em platform.settings (fora da lista de integracoes, nao aparece la). */
const CHAVE_PLATAFORMA = 'lgpd';
/** Chave em tenant_settings do orgao. */
const CHAVE_ORGAO = 'privacidade';

/** jsonb gravado como texto JSON (saves antigos) ou objeto. */
function objeto(v: unknown): Record<string, unknown> | null {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * LGPD: o que a JEOS publica como operadora (painel da plataforma) e o que o
 * orgao informa como controlador (encarregado, uso de IA).
 */
@Injectable()
export class PrivacidadeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async plataforma(): Promise<LgpdPlataforma> {
    const [r] = await this.db.catalog()<Array<{ config: unknown }>>`SELECT config FROM platform.settings WHERE key = ${CHAVE_PLATAFORMA}`;
    const parsed = lgpdPlataformaSchema.safeParse(objeto(r?.config));
    return parsed.success ? parsed.data : LGPD_PLATAFORMA_PADRAO;
  }

  async salvarPlataforma(input: LgpdPlataforma, adminId: string): Promise<{ antes: LgpdPlataforma; depois: LgpdPlataforma }> {
    const antes = await this.plataforma();
    await this.db.catalog()`
      INSERT INTO platform.settings (key, enabled, config, updated_by, updated_at)
      VALUES (${CHAVE_PLATAFORMA}, true, ${this.db.catalog().json(input as never)}, ${adminId}, now())
      ON CONFLICT (key) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    return { antes, depois: input };
  }

  /** Configuracao do orgao do contexto (ou de um schema, para os workers). */
  async orgao(schemaName = requireTenantContext().schemaName): Promise<PrivacidadeOrgao> {
    const [r] = await this.db.tenant(schemaName)<Array<{ valor: unknown }>>`SELECT valor FROM tenant_settings WHERE chave = ${CHAVE_ORGAO}`;
    const parsed = privacidadeOrgaoSchema.safeParse(objeto(r?.valor) ?? {});
    return parsed.success ? parsed.data : privacidadeOrgaoSchema.parse({});
  }

  async salvarOrgao(input: PrivacidadeOrgao, actorId: string, ip: string): Promise<PrivacidadeOrgao> {
    const sql = this.db.tenant(requireTenantContext().schemaName);
    const antes = await this.orgao();
    await sql`
      INSERT INTO tenant_settings (chave, valor) VALUES (${CHAVE_ORGAO}, ${sql.json(input as never)})
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()
    `;
    await this.audit.logTenant({
      actorId,
      action: 'privacidade_atualizada',
      resourceType: 'tenant_settings',
      resourceId: CHAVE_ORGAO,
      ip,
      metadata: { iaDesligada: input.iaDesligada, iaAntes: antes.iaDesligada, encarregado: input.encarregadoNome || null },
    });
    return input;
  }

  /** O orgao proibiu enviar documentos para provedor de IA? */
  async iaDesligada(schemaName?: string): Promise<boolean> {
    try {
      return (await this.orgao(schemaName)).iaDesligada;
    } catch {
      return false;
    }
  }

  async publica(): Promise<PrivacidadePublica> {
    const ctx = requireTenantContext();
    const [o, plataforma] = await Promise.all([this.orgao(), this.plataforma()]);
    return {
      orgao: ctx.nome,
      encarregado: o.encarregadoNome
        ? { nome: o.encarregadoNome, email: o.encarregadoEmail, telefone: o.encarregadoTelefone }
        : null,
      iaDesligada: o.iaDesligada,
      plataforma,
    };
  }
}
