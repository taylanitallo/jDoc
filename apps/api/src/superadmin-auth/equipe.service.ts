import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminConviteInput,
  AdminEquipe,
  AdminSessao,
  AdminUpdateInput,
  PapelAdmin,
  SenhaProvisoriaResposta,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { PasswordService } from '../auth/password.service';
import { AdminSessionsService, SESSAO_OCIOSA_H } from './admin-sessions.service';
import type { AdminReq } from './decorators';

type Origem = { ip: string; userAgent: string };

/** Senha provisoria legivel (sem 0/O, 1/l/I). */
export function gerarSenhaProvisoria(tamanho = 12): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: tamanho }, () => alfabeto[randomInt(alfabeto.length)]).join('');
}

/**
 * Envio do convite/nova senha por e-mail. O modulo de e-mail se registra aqui
 * ao subir; sem SMTP configurado (ou se o envio falhar), a senha provisoria
 * volta na resposta para o owner repassar.
 */
export type EnvioSenhaAdmin = (p: { nome: string; email: string; senha: string; convite: boolean }) => Promise<boolean>;

@Injectable()
export class EquipeService {
  private enviarSenha: EnvioSenhaAdmin | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly sessions: AdminSessionsService,
    private readonly audit: AuditService,
  ) {}

  registrarEnvio(fn: EnvioSenhaAdmin): void {
    this.enviarSenha = fn;
  }

  async listar(): Promise<AdminEquipe[]> {
    const rows = await this.db.catalog()<
      Array<{
        id: string;
        nome: string;
        email: string;
        role: PapelAdmin;
        ativo: boolean;
        totp_enabled: boolean;
        ultimo_acesso: Date | null;
        criado_em: Date;
        sessoes: number;
      }>
    >`
      SELECT a.id, a.nome, a.email, a.role, a.ativo, a.totp_enabled, a.ultimo_acesso, a.criado_em,
        (SELECT count(*)::int FROM platform.admin_sessions s
          WHERE s.admin_id = a.id AND s.revoked_at IS NULL
            AND s.last_seen_at > now() - make_interval(hours => ${SESSAO_OCIOSA_H})) AS sessoes
      FROM public.superadmins a
      ORDER BY a.ativo DESC, a.nome
    `;
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      email: r.email,
      role: r.role,
      ativo: r.ativo,
      mfaEnabled: r.totp_enabled,
      ultimoAcesso: r.ultimo_acesso?.toISOString() ?? null,
      criadoEm: r.criado_em.toISOString(),
      sessoesAtivas: r.sessoes,
    }));
  }

  private async buscar(id: string): Promise<{ id: string; nome: string; email: string; role: PapelAdmin; ativo: boolean }> {
    const [a] = await this.db.catalog()<Array<{ id: string; nome: string; email: string; role: PapelAdmin; ativo: boolean }>>`
      SELECT id, nome, email, role, ativo FROM public.superadmins WHERE id = ${id}
    `;
    if (!a) throw new NotFoundException('Membro da equipe não encontrado');
    return a;
  }

  private async entregarSenha(nome: string, email: string, senha: string, convite: boolean): Promise<SenhaProvisoriaResposta> {
    const enviado = this.enviarSenha ? await this.enviarSenha({ nome, email, senha, convite }).catch(() => false) : false;
    return enviado ? { emailEnviado: true } : { emailEnviado: false, senhaProvisoria: senha };
  }

  async convidar(admin: AdminReq, input: AdminConviteInput, origem: Origem): Promise<SenhaProvisoriaResposta> {
    const sql = this.db.catalog();
    const [existe] = await sql`SELECT 1 FROM public.superadmins WHERE email = ${input.email}`;
    if (existe) throw new ConflictException('Já existe alguém da equipe com este e-mail');
    const senha = gerarSenhaProvisoria();
    const hash = await this.passwords.hash(senha);
    const [novo] = await sql<Array<{ id: string }>>`
      INSERT INTO public.superadmins (email, nome, senha_hash, role, must_change_password)
      VALUES (${input.email}, ${input.nome}, ${hash}, ${input.role}, true)
      RETURNING id
    `;
    await this.audit.logAdmin(admin, origem, {
      action: 'admin_convidado',
      entity: 'admin',
      entityId: novo!.id,
      depois: { nome: input.nome, email: input.email, papel: input.role },
    });
    return this.entregarSenha(input.nome, input.email, senha, true);
  }

  /** Nao deixa a plataforma sem nenhum owner ativo. */
  private async garantirOutroOwner(alvoId: string): Promise<void> {
    const [r] = await this.db.catalog()<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM public.superadmins WHERE role = 'owner' AND ativo = true AND id <> ${alvoId}
    `;
    if (!r || r.n === 0) throw new BadRequestException('A plataforma precisa de pelo menos um proprietário ativo');
  }

  async atualizar(admin: AdminReq, id: string, input: AdminUpdateInput, origem: Origem): Promise<AdminEquipe> {
    const antes = await this.buscar(id);
    const tiraOwner = antes.role === 'owner' && ((input.role && input.role !== 'owner') || input.ativo === false);
    if (tiraOwner) await this.garantirOutroOwner(id);
    if (id === admin.id && input.ativo === false) throw new BadRequestException('Você não pode desativar a própria conta');

    const sql = this.db.catalog();
    await sql`
      UPDATE public.superadmins SET
        nome = ${input.nome ?? antes.nome},
        role = ${input.role ?? antes.role},
        ativo = ${input.ativo ?? antes.ativo}
      WHERE id = ${id}
    `;
    if (input.ativo === false) await this.sessions.revogarTodas(id);
    this.sessions.esquecerAdmin(id);

    const depois = { nome: input.nome ?? antes.nome, papel: input.role ?? antes.role, ativo: input.ativo ?? antes.ativo };
    await this.audit.logAdmin(admin, origem, {
      action: 'admin_atualizado',
      entity: 'admin',
      entityId: id,
      antes: { nome: antes.nome, papel: antes.role, ativo: antes.ativo },
      depois,
    });
    const lista = await this.listar();
    return lista.find((a) => a.id === id)!;
  }

  async redefinirSenha(admin: AdminReq, id: string, origem: Origem): Promise<SenhaProvisoriaResposta> {
    const alvo = await this.buscar(id);
    const senha = gerarSenhaProvisoria();
    const hash = await this.passwords.hash(senha);
    await this.db.catalog()`
      UPDATE public.superadmins SET senha_hash = ${hash}, must_change_password = true WHERE id = ${id}
    `;
    await this.sessions.revogarTodas(id);
    await this.audit.logAdmin(admin, origem, { action: 'admin_senha_redefinida', entity: 'admin', entityId: id });
    return this.entregarSenha(alvo.nome, alvo.email, senha, false);
  }

  async resetarMfa(admin: AdminReq, id: string, origem: Origem): Promise<void> {
    await this.buscar(id);
    await this.db.catalog()`
      UPDATE public.superadmins SET totp_enabled = false, totp_secret = NULL, totp_secret_pending = NULL WHERE id = ${id}
    `;
    await this.sessions.revogarTodas(id);
    await this.audit.logAdmin(admin, origem, { action: 'admin_mfa_resetado', entity: 'admin', entityId: id });
  }

  async encerrarSessoes(admin: AdminReq, id: string, origem: Origem): Promise<{ encerradas: number }> {
    await this.buscar(id);
    const encerradas = await this.sessions.revogarTodas(id, id === admin.id ? admin.sid : undefined);
    await this.audit.logAdmin(admin, origem, {
      action: 'admin_sessoes_encerradas',
      entity: 'admin',
      entityId: id,
      metadata: { encerradas },
    });
    return { encerradas };
  }

  async sessoes(id: string): Promise<AdminSessao[]> {
    await this.buscar(id);
    return this.sessions.listar(id);
  }
}
