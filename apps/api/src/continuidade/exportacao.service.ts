import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { ExportacaoView, ParteExportacao } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { loadEnv } from '../config/env';

export const EXPORTACAO_QUEUE = 'exportacao';

export interface ExportacaoJobData {
  exportacaoId: string;
  tenantId: string;
  slug: string;
  schemaName: string;
  nome: string;
}

interface Row {
  id: string;
  status: ExportacaoView['status'];
  orgao_codigo: string | null;
  partes: unknown;
  documentos: number | null;
  arquivos: number | null;
  bytes: string | null;
  erro: string | null;
  solicitado_por: string | null;
  criado_em: Date;
  concluido_em: Date | null;
  expira_em: Date | null;
}

export type ParteGuardada = ParteExportacao & { key: string };

export function partesDe(v: unknown): ParteGuardada[] {
  const p = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(p) ? (p as ParteGuardada[]) : [];
}

/** Exportacao integral do orgao: pedido, lista e link de download de cada parte. */
@Injectable()
export class ExportacaoService implements OnModuleDestroy {
  private readonly queue: Queue<ExportacaoJobData>;
  private readonly redis: Redis;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<ExportacaoJobData>(EXPORTACAO_QUEUE, { connection: this.redis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.redis.quit();
  }

  private view(r: Row): ExportacaoView {
    return {
      id: r.id,
      status: r.status,
      orgaoCodigo: r.orgao_codigo,
      partes: partesDe(r.partes).map(({ key: _key, ...p }) => p),
      documentos: r.documentos,
      arquivos: r.arquivos,
      bytes: r.bytes === null ? null : Number(r.bytes),
      erro: r.erro,
      solicitadoPor: r.solicitado_por,
      criadoEm: r.criado_em.toISOString(),
      concluidoEm: r.concluido_em?.toISOString() ?? null,
      expiraEm: r.expira_em?.toISOString() ?? null,
      expirada: !!r.expira_em && r.expira_em.getTime() < Date.now(),
    };
  }

  async listar(schemaName: string): Promise<ExportacaoView[]> {
    const rows = await this.db.tenant(schemaName)<Row[]>`SELECT * FROM exportacoes ORDER BY criado_em DESC LIMIT 20`;
    return rows.map((r) => this.view(r));
  }

  async solicitar(
    alvo: { tenantId: string; slug: string; schemaName: string; nome: string },
    orgaoCodigo: string | null,
    autor: { id: string | null; nome: string },
  ): Promise<ExportacaoView> {
    const sql = this.db.tenant(alvo.schemaName);
    const [andamento] = await sql`SELECT 1 FROM exportacoes WHERE status IN ('pendente', 'processando')`;
    if (andamento) throw new ConflictException('Já existe uma exportação em andamento para este órgão');
    const [r] = await sql<Row[]>`
      INSERT INTO exportacoes (orgao_codigo, solicitado_por, solicitado_por_id)
      VALUES (${orgaoCodigo}, ${autor.nome}, ${autor.id})
      RETURNING *
    `;
    await this.queue.add('exportar', { exportacaoId: r!.id, ...alvo }, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    return this.view(r!);
  }

  async urlParte(slug: string, schemaName: string, id: string, numero: number): Promise<{ url: string; nome: string }> {
    const [r] = await this.db.tenant(schemaName)<Row[]>`SELECT * FROM exportacoes WHERE id = ${id}`;
    if (!r) throw new NotFoundException('Exportação não encontrada');
    if (r.status !== 'concluido') throw new BadRequestException('A exportação ainda não está pronta');
    if (r.expira_em && r.expira_em.getTime() < Date.now()) throw new BadRequestException('Exportação expirada: gere uma nova');
    const parte = partesDe(r.partes).find((p) => p.numero === numero);
    if (!parte) throw new NotFoundException('Parte não encontrada');
    const url = await this.storage.createSignedUrl(slug, parte.key, 600, parte.nome.replace(/\.zip$/, ''));
    return { url, nome: parte.nome };
  }

  /** Ha exportacao concluida (pre-requisito do aceite da migracao)? */
  async temConcluida(schemaName: string): Promise<boolean> {
    const [r] = await this.db.tenant(schemaName)`SELECT 1 FROM exportacoes WHERE status = 'concluido' LIMIT 1`;
    return !!r;
  }
}
