import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Sql } from 'postgres';
import {
  TENANT_ROLES,
  type CompartilhadosPage,
  type CompartilhadosQuery,
  type CompartilharDocumentoInput,
  type DestinatarioCompartilhamento,
  type DocModule,
  type TenantAccessClaims,
  type TenantRole,
} from '@jdoc/shared';
import { AuditService } from '../audit/audit.module';
import { dentroDaLotacao, filtroLotacao, podeVerRestrito, podeVerSigiloso } from '../common/acesso-documento';
import { DatabaseService } from '../database/database.service';
import { requireTenantContext } from '../tenancy/tenant-context';
import { DocumentsService } from './documents.service';

interface LinhaRecebido {
  id: string;
  document_id: string;
  assunto: string | null;
  descricao: string | null;
  original_name: string;
  tem_arquivo: boolean;
  de_nome: string;
  mensagem: string | null;
  criado_em: Date;
  visto_em: Date | null;
}

/**
 * Compartilhamento entre usuarios do orgao (sem link publico). Nao concede
 * acesso: o destinatario precisa poder ler o documento pelo proprio perfil,
 * lotacao e sigilo, e a lista "recebidos" reaplica essas regras a cada leitura.
 */
@Injectable()
export class CompartilhamentoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly docs: DocumentsService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  /** Usuarios ativos, exceto quem compartilha, que conseguem ler o documento. */
  private async elegiveis(user: TenantAccessClaims, documentId: string): Promise<DestinatarioCompartilhamento[]> {
    const doc = await this.docs.dadosDeAcesso(user, documentId);
    const rows = await this.sql()<
      Array<{ id: string; nome: string; email: string; role: string; orgaos_codigos: string[] | null; permissoes: string[] }>
    >`
      SELECT u.id, u.nome, u.email, u.role, u.orgaos_codigos,
             coalesce((SELECT array_agg(p.permission_key) FROM user_permissions p WHERE p.user_id = u.id), '{}') AS permissoes
      FROM users u
      WHERE u.ativo = true AND u.id <> ${user.sub}
      ORDER BY u.nome
    `;
    return rows
      .filter((u) => {
        const role: TenantRole = (TENANT_ROLES as readonly string[]).includes(u.role) ? (u.role as TenantRole) : 'consulta';
        const claims: TenantAccessClaims = {
          sub: u.id,
          tenantId: user.tenantId,
          tenantSlug: user.tenantSlug,
          role,
          permissions: u.permissoes,
          realm: 'tenant',
          ...(u.orgaos_codigos?.length ? { lot: u.orgaos_codigos } : {}),
        };
        return this.podeLer(claims, doc);
      })
      .map(({ id, nome, email }) => ({ id, nome, email }));
  }

  private podeLer(
    u: TenantAccessClaims,
    doc: { module: DocModule; restrito: boolean; sigiloso: boolean; orgaoCodigo: string | null },
  ): boolean {
    if (u.role !== 'admin' && !u.permissions.includes(`${doc.module}:read`)) return false;
    if (doc.restrito && !podeVerRestrito(u)) return false;
    if (doc.sigiloso && !podeVerSigiloso(u)) return false;
    return dentroDaLotacao(u, doc.orgaoCodigo);
  }

  destinatarios(user: TenantAccessClaims, documentId: string): Promise<DestinatarioCompartilhamento[]> {
    return this.elegiveis(user, documentId);
  }

  async compartilhar(user: TenantAccessClaims, documentId: string, input: CompartilharDocumentoInput, ip: string): Promise<void> {
    const permitidos = new Set((await this.elegiveis(user, documentId)).map((d) => d.id));
    const destinatarios = [...new Set(input.destinatarios)];
    if (destinatarios.some((id) => !permitidos.has(id))) {
      throw new BadRequestException('Há usuário escolhido sem acesso a este documento');
    }
    const sql = this.sql();
    const mensagem = input.mensagem || null;
    for (const para of destinatarios) {
      await sql`
        INSERT INTO documento_compartilhamentos (document_id, de_usuario, para_usuario, mensagem)
        VALUES (${documentId}, ${user.sub}, ${para}, ${mensagem})
        ON CONFLICT (document_id, de_usuario, para_usuario)
        DO UPDATE SET mensagem = EXCLUDED.mensagem, criado_em = now(), visto_em = NULL
      `;
    }
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_shared',
      resourceType: 'document',
      resourceId: documentId,
      ip,
      metadata: { count: destinatarios.length, destinatarios },
    });
  }

  async recebidos(user: TenantAccessClaims, q: CompartilhadosQuery): Promise<CompartilhadosPage> {
    const sql = this.sql();
    const modulos = user.permissions.filter((p) => p.endsWith(':read')).map((p) => p.slice(0, -':read'.length));
    const moduloLegivel = user.role === 'admin' ? sql`true` : modulos.length ? sql`d.module::text IN ${sql(modulos)}` : sql`false`;
    const condicao = sql`
      c.para_usuario = ${user.sub}
      AND d.deleted_at IS NULL
      AND ${moduloLegivel}
      AND (${podeVerRestrito(user)} OR d.nivel_acesso = 'publico')
      AND ${filtroLotacao(sql, user)}
    `;
    const [contagem] = await sql<Array<{ total: number; nao_vistos: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE c.visto_em IS NULL)::int AS nao_vistos
      FROM documento_compartilhamentos c JOIN documents d ON d.id = c.document_id
      WHERE ${condicao}
    `;
    const rows = await sql<LinhaRecebido[]>`
      SELECT c.id, c.document_id, d.assunto, d.descricao, d.original_name, d.file_key IS NOT NULL AS tem_arquivo,
             u.nome AS de_nome, c.mensagem, c.criado_em, c.visto_em
      FROM documento_compartilhamentos c
      JOIN documents d ON d.id = c.document_id
      JOIN users u ON u.id = c.de_usuario
      WHERE ${condicao}
      ORDER BY c.criado_em DESC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
    `;
    return {
      items: rows.map((r) => ({
        id: r.id,
        documentId: r.document_id,
        titulo: r.assunto || r.descricao || r.original_name,
        temArquivo: r.tem_arquivo,
        deNome: r.de_nome,
        mensagem: r.mensagem,
        criadoEm: r.criado_em.toISOString(),
        vistoEm: r.visto_em?.toISOString() ?? null,
      })),
      total: contagem?.total ?? 0,
      naoVistos: contagem?.nao_vistos ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async marcarVisto(user: TenantAccessClaims, id: string): Promise<void> {
    const r = await this.sql()`
      UPDATE documento_compartilhamentos SET visto_em = coalesce(visto_em, now())
      WHERE id = ${id} AND para_usuario = ${user.sub}
    `;
    if (r.count === 0) throw new NotFoundException('Compartilhamento não encontrado');
  }
}
