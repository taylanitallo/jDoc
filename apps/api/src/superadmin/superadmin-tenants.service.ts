import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { HEX_COR, SCHEMA_NAME_REGEX } from '@jdoc/shared';
import type {
  Ambiente,
  Contrato,
  CreateTenantInput,
  MenuOverrides,
  SetQuotaInput,
  SetTenantStatusInput,
  TenantOverview,
  UpdateTenantInput,
  Sistema,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { AuditService } from '../audit/audit.module';
import { StorageService, detectImageExt } from '../storage/storage.module';
import { resolveBrasaoUrl } from '../tenancy/brasao.util';

const BRASAO_URL_TTL_S = 3600;
const BRASAO_MAX_BYTES = 2 * 1024 * 1024;

interface TenantRow {
  id: string;
  slug: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  responsavel: string | null;
  email: string | null;
  status: string;
  quota_disco_mb: number;
  brasao_url: string | null;
  schema_name: string;
  criado_em: Date;
  modulos: Sistema[];
  cnpj: string | null;
  ambiente: Ambiente;
  contrato: Contrato;
  menu_overrides: MenuOverrides;
  motivo_status: string | null;
}

const COLUNAS = `id, slug, nome, cidade, uf, responsavel, email, status, quota_disco_mb, brasao_url, schema_name,
  criado_em, modulos, cnpj, ambiente, contrato, menu_overrides, motivo_status`;

/** Uso do orgao que nao esta no catalogo: usuarios ativos, ultimo acesso e cor da marca. */
interface ResumoOrgao {
  usuariosAtivos: number;
  ultimoAcesso: Date | null;
  corMarca: string | null;
}

@Injectable()
export class SuperadminTenantsService {
  private readonly logger = new Logger(SuperadminTenantsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Le do schema do orgao o que o painel mostra (falha = zeros, nao derruba a lista). */
  async resumo(schemaName: string): Promise<ResumoOrgao> {
    try {
      const sql = this.db.tenant(schemaName);
      const [u] = await sql<Array<{ ativos: number; ultimo: Date | null }>>`
        SELECT count(*) FILTER (WHERE ativo)::int AS ativos, max(ultimo_acesso) AS ultimo FROM users
      `;
      const [c] = await sql<Array<{ valor: unknown }>>`SELECT valor FROM tenant_settings WHERE chave = 'corDestaque'`;
      const cor = typeof c?.valor === 'string' && HEX_COR.test(c.valor) ? c.valor : null;
      return { usuariosAtivos: u?.ativos ?? 0, ultimoAcesso: u?.ultimo ?? null, corMarca: cor };
    } catch {
      return { usuariosAtivos: 0, ultimoAcesso: null, corMarca: null };
    }
  }

  private toOverview(row: TenantRow, usoBytes: number, brasaoUrl: string | null, r: ResumoOrgao): TenantOverview {
    const quotaBytes = row.quota_disco_mb * 1024 * 1024;
    return {
      id: row.id,
      slug: row.slug,
      nome: row.nome,
      cidade: row.cidade,
      uf: row.uf,
      responsavel: row.responsavel,
      email: row.email,
      status: row.status,
      quotaDiscoMb: row.quota_disco_mb,
      brasaoUrl,
      modulos: row.modulos ?? ['financeiro'],
      criadoEm: row.criado_em.toISOString(),
      usoBytes,
      usoPercent: quotaBytes > 0 ? Math.round((usoBytes / quotaBytes) * 1000) / 10 : 0,
      cnpj: row.cnpj,
      ambiente: row.ambiente ?? 'producao',
      contrato: row.contrato ?? {},
      menuOverrides: row.menu_overrides ?? {},
      motivoStatus: row.motivo_status,
      corMarca: r.corMarca,
      usuariosAtivos: r.usuariosAtivos,
      ultimoAcesso: r.ultimoAcesso?.toISOString() ?? null,
    };
  }

  async list(): Promise<TenantOverview[]> {
    const sql = this.db.catalog();
    const rows = await sql<TenantRow[]>`SELECT ${sql.unsafe(COLUNAS)} FROM public.tenants ORDER BY nome`;
    return Promise.all(
      rows.map(async (r) =>
        this.toOverview(
          r,
          await this.storage.usageBytes(r.slug),
          await resolveBrasaoUrl(this.db, this.storage, r.schema_name, r.slug),
          await this.resumo(r.schema_name),
        ),
      ),
    );
  }

  async getById(id: string): Promise<TenantRow> {
    const sql = this.db.catalog();
    const rows = await sql<TenantRow[]>`SELECT ${sql.unsafe(COLUNAS)} FROM public.tenants WHERE id = ${id} LIMIT 1`;
    const row = rows[0];
    if (!row) throw new NotFoundException('Orgao nao encontrado');
    return row;
  }

  async overview(id: string): Promise<TenantOverview> {
    const row = await this.getById(id);
    return this.toOverview(
      row,
      await this.storage.usageBytes(row.slug),
      await resolveBrasaoUrl(this.db, this.storage, row.schema_name, row.slug),
      await this.resumo(row.schema_name),
    );
  }

  async create(
    input: CreateTenantInput,
    actorId: string,
    ip: string,
  ): Promise<{ id: string; schemaName: string }> {
    const result = await this.provisioning.provisionTenant(input);
    await this.db.catalog()`
      UPDATE public.tenants SET cnpj = ${input.cnpj ?? null}, ambiente = ${input.ambiente} WHERE id = ${result.id}
    `;
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_created',
      targetTenantId: result.id,
      entity: 'tenant',
      entityId: result.id,
      ip,
      changes: { depois: { slug: input.slug, nome: input.nome, cidade: input.cidade, uf: input.uf, modulos: input.modulos } },
    });
    return result;
  }

  async update(id: string, input: UpdateTenantInput, actorId: string, ip: string): Promise<void> {
    const row = await this.getById(id);
    const sql = this.db.catalog();
    const { corMarca, ...cadastro } = input;
    await sql`
      UPDATE public.tenants SET
        nome = ${input.nome ?? row.nome},
        cidade = ${input.cidade ?? row.cidade},
        uf = ${input.uf ?? row.uf},
        responsavel = ${input.responsavel ?? row.responsavel},
        email = ${input.email ?? row.email},
        brasao_url = ${input.brasaoUrl === undefined ? row.brasao_url : input.brasaoUrl},
        modulos = ${input.modulos ?? row.modulos},
        cnpj = ${input.cnpj === undefined ? row.cnpj : input.cnpj},
        ambiente = ${input.ambiente ?? row.ambiente},
        contrato = ${sql.json((input.contrato ?? row.contrato ?? {}) as Record<string, never>)},
        menu_overrides = ${sql.json((input.menuOverrides ?? row.menu_overrides ?? {}) as Record<string, never>)},
        atualizado_em = now()
      WHERE id = ${id}
    `;
    let corAntes: string | null | undefined;
    if (corMarca !== undefined) {
      const tsql = this.db.tenant(row.schema_name);
      corAntes = (await this.resumo(row.schema_name)).corMarca;
      if (corMarca === null) await tsql`DELETE FROM tenant_settings WHERE chave = 'corDestaque'`;
      else
        await tsql`
          INSERT INTO tenant_settings (chave, valor) VALUES ('corDestaque', ${tsql.json(corMarca)})
          ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()
        `;
    }
    await this.tenancy.invalidate(row.slug);
    const antes: Record<string, unknown> = {};
    const depois: Record<string, unknown> = {};
    const atual = row as unknown as Record<string, unknown>;
    const coluna: Record<string, string> = { quotaDiscoMb: 'quota_disco_mb', brasaoUrl: 'brasao_url', menuOverrides: 'menu_overrides' };
    for (const [k, v] of Object.entries(cadastro)) {
      antes[k] = atual[coluna[k] ?? k] ?? null;
      depois[k] = v;
    }
    if (corMarca !== undefined) {
      antes.corMarca = corAntes ?? null;
      depois.corMarca = corMarca;
    }
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_updated',
      targetTenantId: id,
      entity: 'tenant',
      entityId: id,
      ip,
      changes: { antes, depois },
    });
  }

  /** Ativar/desativar com invalidacao IMEDIATA do cache — bloqueio na hora. */
  async setStatus(
    id: string,
    input: SetTenantStatusInput,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const row = await this.getById(id);
    const sql = this.db.catalog();
    const motivo = input.status === 'ativo' ? null : (input.motivo ?? null);
    await sql`
      UPDATE public.tenants SET status = ${input.status}, motivo_status = ${motivo}, atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.tenancy.invalidate(row.slug);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: input.status === 'ativo' ? 'tenant_activated' : 'tenant_deactivated',
      targetTenantId: id,
      entity: 'tenant',
      entityId: id,
      ip,
      changes: { antes: { status: row.status }, depois: { status: input.status, motivo } },
      metadata: { slug: row.slug },
    });
  }

  /**
   * Exclusao DEFINITIVA do orgao: apaga o schema (documentos, usuarios, configuracoes),
   * o registro no catalogo e todos os arquivos. Exige o orgao inativo e o slug digitado.
   * O log global (global_audit_logs) fica — e a prova de quem excluiu e quando.
   */
  async remove(id: string, confirmacao: string, actorId: string, ip: string): Promise<void> {
    const row = await this.getById(id);
    if (row.status !== 'inativo' && row.status !== 'arquivado') throw new ConflictException('Suspenda ou arquive o órgão antes de excluir');
    if (confirmacao.trim().toLowerCase() !== row.slug) throw new BadRequestException('Digite o slug do órgão para confirmar a exclusão');
    if (!SCHEMA_NAME_REGEX.test(row.schema_name)) throw new BadRequestException('Schema inválido');

    await this.db.closeTenant(row.schema_name);
    const direct = this.db.direct();
    try {
      await direct.begin(async (tx) => {
        await tx.unsafe(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
        await tx.unsafe('DELETE FROM public.tenants WHERE id = $1', [id]);
      });
    } finally {
      await direct.end({ timeout: 5 });
    }
    await this.tenancy.invalidate(row.slug);
    // Arquivos por ultimo: se o storage falhar, o orgao ja nao existe e o log registra a pendencia.
    let arquivos = 'removidos';
    try {
      await this.storage.deleteAll(row.slug);
    } catch (e) {
      arquivos = `falha: ${(e as Error).message}`;
      this.logger.error(`Orgao ${row.slug} excluido, mas os arquivos nao foram removidos: ${(e as Error).message}`);
    }
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_deleted',
      targetTenantId: id,
      ip,
      metadata: { slug: row.slug, nome: row.nome, arquivos },
    });
  }

  async setQuota(id: string, input: SetQuotaInput, actorId: string, ip: string): Promise<void> {
    const row = await this.getById(id);
    const sql = this.db.catalog();
    await sql`
      UPDATE public.tenants SET quota_disco_mb = ${input.quotaDiscoMb}, atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.tenancy.invalidate(row.slug);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_quota_changed',
      targetTenantId: id,
      ip,
      metadata: { de: row.quota_disco_mb, para: input.quotaDiscoMb },
    });
  }

  /** Superadmin sobe o brasao em nome do orgao (evita depender do proprio
   *  responsavel do tenant logar e fazer isso em /t/:slug/configuracoes). */
  async uploadBrasao(
    id: string,
    file: { buffer: Buffer; size: number },
    actorId: string,
    ip: string,
  ): Promise<{ brasaoUrl: string }> {
    const row = await this.getById(id);
    if (file.size > BRASAO_MAX_BYTES) {
      throw new PayloadTooLargeException('Imagem do brasão excede 2MB');
    }
    const ext = detectImageExt(file.buffer);
    if (!ext) throw new BadRequestException('Envie uma imagem PNG ou JPEG');

    const sql = this.db.tenant(row.schema_name);
    const prevRows = await sql<Array<{ valor: string | unknown }>>`
      SELECT valor FROM tenant_settings WHERE chave = 'brasaoKey'
    `;
    const prevRaw = prevRows[0]?.valor;
    const prevKey = prevRaw ? (typeof prevRaw === 'string' ? (JSON.parse(prevRaw) as string) : (prevRaw as string)) : null;

    const key = `${randomUUID()}.${ext}`;
    await this.storage.upload(row.slug, key, file.buffer);
    await sql.unsafe(
      `INSERT INTO tenant_settings (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      ['brasaoKey', JSON.stringify(key)],
    );
    if (prevKey) await this.storage.delete(row.slug, prevKey).catch(() => undefined);

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_brasao_updated',
      targetTenantId: id,
      ip,
      metadata: { key },
    });

    const brasaoUrl = await this.storage.createSignedUrl(row.slug, key, BRASAO_URL_TTL_S);
    return { brasaoUrl };
  }

  async deleteBrasao(id: string, actorId: string, ip: string): Promise<void> {
    const row = await this.getById(id);
    const sql = this.db.tenant(row.schema_name);
    const rows = await sql<Array<{ valor: string | unknown }>>`
      SELECT valor FROM tenant_settings WHERE chave = 'brasaoKey'
    `;
    const raw = rows[0]?.valor;
    const key = raw ? (typeof raw === 'string' ? (JSON.parse(raw) as string) : (raw as string)) : null;
    if (key) await this.storage.delete(row.slug, key).catch(() => undefined);
    await sql`DELETE FROM tenant_settings WHERE chave = 'brasaoKey'`;

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_brasao_removed',
      targetTenantId: id,
      ip,
    });
  }
}
