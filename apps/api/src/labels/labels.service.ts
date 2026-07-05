import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  parseLabels,
  type LabelsImportView,
  type LabelsImportsQuery,
  type LabelsPreview,
  type LabelsUploadFields,
  type ParseError,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';
import { filterByOrgaoImporta } from './orgao-filter';
import { filterDuplicates } from './duplicate-filter';

export const LABELS_QUEUE = 'labels-import';
const MAX_LABEL_FILE_BYTES = 2 * 1024 * 1024; // 2 MB de TXT/CSV
const PREVIEW_SAMPLE = 20;

export interface LabelsJobData {
  schemaName: string;
  slug: string;
  tenantId: string;
  importId: string;
  actorId: string;
}

interface ImportRow {
  id: string;
  formato: string;
  module: string;
  original_name: string;
  status: string;
  total_registros: number;
  registros_ok: number;
  registros_erro: number;
  relatorio_erros: ParseError[] | null;
  criado_em: Date;
  concluido_em: Date | null;
}

function toView(r: ImportRow): LabelsImportView {
  // jsonb pode chegar como string dependendo do driver — parse defensivo.
  const relatorio =
    typeof r.relatorio_erros === 'string'
      ? (JSON.parse(r.relatorio_erros) as ParseError[])
      : r.relatorio_erros;
  return {
    id: r.id,
    formato: r.formato,
    module: r.module,
    originalName: r.original_name,
    status: r.status,
    totalRegistros: r.total_registros,
    registrosOk: r.registros_ok,
    registrosErro: r.registros_erro,
    relatorioErros: relatorio,
    criadoEm: r.criado_em.toISOString(),
    concluidoEm: r.concluido_em ? r.concluido_em.toISOString() : null,
  };
}

@Injectable()
export class LabelsService implements OnModuleDestroy {
  private readonly queue: Queue<LabelsJobData>;
  private readonly queueRedis: Redis;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {
    // BullMQ exige conexao propria (maxRetriesPerRequest: null).
    this.queueRedis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<LabelsJobData>(LABELS_QUEUE, { connection: this.queueRedis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.queueRedis.quit();
  }

  private decodeFile(file: { buffer: Buffer; size: number }): string {
    if (file.size > MAX_LABEL_FILE_BYTES) {
      throw new PayloadTooLargeException('Arquivo de etiquetas excede 2 MB');
    }
    if (file.buffer.includes(0)) {
      throw new BadRequestException('Arquivo invalido: esperado TXT/CSV de texto');
    }
    return file.buffer.toString('utf-8');
  }

  private assertPermission(user: TenantAccessClaims, module: string, action: string): void {
    if (user.role === 'admin') return;
    if (!user.permissions.includes(`${module}:${action}`)) {
      throw new ForbiddenException('Acesso negado');
    }
  }

  /**
   * PREVIEW: parse em memoria, NADA e gravado.
   * Retorna registros interpretados + relatorio de erros linha a linha.
   */
  async preview(
    user: TenantAccessClaims,
    fields: LabelsUploadFields,
    file: { buffer: Buffer; size: number },
  ): Promise<LabelsPreview> {
    const ctx = requireTenantContext();
    this.assertPermission(user, fields.module, 'create');
    const content = this.decodeFile(file);
    const result = parseLabels(content, fields.module, fields.formato);
    if (!result) {
      throw new BadRequestException(
        'Formato do arquivo nao reconhecido. Selecione SS, ASPEC ou JBS manualmente.',
      );
    }
    const sql = this.db.tenant(ctx.schemaName);
    const semDuplicados = await filterDuplicates(sql, fields.module, result.records, result.errors);
    const { records, errors } = await filterByOrgaoImporta(sql, semDuplicados.records, semDuplicados.errors);
    return {
      formato: result.format,
      totalLinhas: result.totalLines,
      totalValidos: records.length,
      totalErros: errors.length,
      amostra: records.slice(0, PREVIEW_SAMPLE),
      erros: errors,
    };
  }

  /** CONFIRMACAO: grava labels_imports + enfileira processamento em background. */
  async enqueue(
    user: TenantAccessClaims,
    fields: LabelsUploadFields,
    file: { buffer: Buffer; size: number; originalname: string },
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    this.assertPermission(user, fields.module, 'create');
    const content = this.decodeFile(file);

    const result = parseLabels(content, fields.module, fields.formato);
    if (!result) {
      throw new BadRequestException(
        'Formato do arquivo nao reconhecido. Selecione SS, ASPEC ou JBS manualmente.',
      );
    }
    if (result.records.length === 0) {
      throw new BadRequestException('Nenhum registro valido para importar');
    }

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO labels_imports (formato, module, original_name, file_content, status, created_by)
      VALUES (
        ${result.format},
        ${fields.module},
        ${file.originalname.slice(0, 255)},
        ${content},
        'pendente',
        ${user.sub}
      )
      RETURNING id
    `;
    const importId = rows[0]?.id ?? '';

    await this.queue.add('import', {
      schemaName: ctx.schemaName,
      slug: ctx.slug,
      tenantId: ctx.tenantId,
      importId,
      actorId: user.sub,
    });

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'labels_import_queued',
      resourceType: 'labels_import',
      resourceId: importId,
      ip,
      metadata: {
        formato: result.format,
        module: fields.module,
        originalName: file.originalname,
        totalLinhas: result.totalLines,
      },
    });

    return { id: importId };
  }

  async list(q: LabelsImportsQuery): Promise<{ items: LabelsImportView[]; total: number }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (q.page - 1) * q.pageSize;
    const rows = await sql<ImportRow[]>`
      SELECT id, formato, module, original_name, status, total_registros,
             registros_ok, registros_erro, relatorio_erros, criado_em, concluido_em
      FROM labels_imports ORDER BY criado_em DESC
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM labels_imports
    `;
    return { items: rows.map(toView), total: Number(totalRows[0]?.total ?? 0) };
  }

  /** Status para polling. */
  async get(id: string): Promise<LabelsImportView> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<ImportRow[]>`
      SELECT id, formato, module, original_name, status, total_registros,
             registros_ok, registros_erro, relatorio_erros, criado_em, concluido_em
      FROM labels_imports WHERE id = ${id} LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Importacao nao encontrada');
    return toView(row);
  }
}
