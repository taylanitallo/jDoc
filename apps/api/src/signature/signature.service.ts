import { ForbiddenException, Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { TenantAccessClaims } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';

export const SIGNATURE_QUEUE = 'signature-validation';

export interface SignatureJobData {
  schemaName: string;
  slug: string;
  /** Documento "dono" (pra permissao/logs) — nem sempre a linha atualizada, ver targetTable/targetId. */
  documentId: string;
  /** Onde gravar o resultado: o documento principal, ou um arquivo extra dele. */
  targetTable: 'documents' | 'document_files';
  targetId: string;
  fileKey: string;
}

export interface SignatureDetailView {
  assinaturaStatus: string;
  assinadoPor: string | null;
  verificadaEm: string | null;
}

@Injectable()
export class SignatureService implements OnModuleDestroy {
  private readonly queue: Queue<SignatureJobData>;
  private readonly queueRedis: Redis;

  constructor(private readonly db: DatabaseService) {
    this.queueRedis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<SignatureJobData>(SIGNATURE_QUEUE, { connection: this.queueRedis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.queueRedis.quit();
  }

  /** Enfileira a validacao de assinatura de um documento recem-enviado. */
  async enqueueValidation(data: SignatureJobData): Promise<void> {
    await this.queue.add('validate', data);
  }

  private assertPermission(user: TenantAccessClaims, module: string): void {
    if (user.role === 'admin') return;
    if (!user.permissions.includes(`${module}:read`)) {
      throw new ForbiddenException('Acesso negado');
    }
  }

  /** Detalhe da assinatura (colunas gravadas pelo worker). */
  async getDetail(user: TenantAccessClaims, documentId: string): Promise<SignatureDetailView> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<
      Array<{
        module: string;
        assinatura_status: string;
        assinado_por: string | null;
        assinatura_verificada_em: Date | null;
      }>
    >`
      SELECT module, assinatura_status, assinado_por, assinatura_verificada_em
      FROM documents WHERE id = ${documentId} AND deleted_at IS NULL LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Documento nao encontrado');
    this.assertPermission(user, row.module);
    return {
      assinaturaStatus: row.assinatura_status,
      assinadoPor: row.assinado_por,
      verificadaEm: row.assinatura_verificada_em ? row.assinatura_verificada_em.toISOString() : null,
    };
  }
}
