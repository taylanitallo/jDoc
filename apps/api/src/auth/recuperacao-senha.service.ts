import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { EsqueciSenhaInput, RedefinirSenhaInput } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { EmailService } from '../email/email.service';
import { requireTenantContext } from '../tenancy/tenant-context';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';
import { BruteForceService } from './brute-force.service';

const LINK_MIN = 60;
const CODIGO_MIN = 15;
const MAX_TENTATIVAS = 5;
/** Tempo minimo entre dois pedidos do mesmo usuario (evita encher a caixa de e-mail). */
const INTERVALO_S = 60;
const INVALIDO = 'Link ou código inválido ou expirado. Peça uma nova recuperação.';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * "Esqueci a senha" do usuario do orgao: o pedido (CPF ou e-mail) gera um
 * link de uso unico (1 h) e um codigo de 6 digitos (15 min, 5 tentativas),
 * enviados pelo SMTP do orgao ou da plataforma. Resposta sempre igual, exista
 * ou nao a conta. So os hashes ficam no banco.
 */
@Injectable()
export class RecuperacaoSenhaService {
  private readonly logger = new Logger(RecuperacaoSenhaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly email: EmailService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly bruteForce: BruteForceService,
    private readonly audit: AuditService,
  ) {}

  private async acharUsuario(identificador: string): Promise<{ id: string; nome: string; email: string } | undefined> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const id = identificador.trim().toLowerCase();
    const digitos = id.replace(/\D/g, '');
    const [u] = id.includes('@')
      ? await sql<Array<{ id: string; nome: string; email: string }>>`SELECT id, nome, email FROM users WHERE email = ${id} AND ativo LIMIT 1`
      : digitos.length === 11
        ? await sql<Array<{ id: string; nome: string; email: string }>>`SELECT id, nome, email FROM users WHERE cpf = ${digitos} AND ativo LIMIT 1`
        : [];
    return u;
  }

  async solicitar(input: EsqueciSenhaInput, ip: string, userAgent: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const u = await this.acharUsuario(input.identificador);
    if (!u) {
      await this.audit.logTenant({ action: 'senha_recuperacao_sem_conta', ip, userAgent });
      return;
    }
    const [recente] = await sql`
      SELECT 1 FROM password_resets
      WHERE user_id = ${u.id} AND usado_em IS NULL AND criado_em > now() - make_interval(secs => ${INTERVALO_S})
    `;
    if (recente) return; // ja mandou ha pouco: nao reenvia, resposta continua igual

    const token = randomBytes(32).toString('hex');
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await sql.begin(async (tx) => {
      // Um pedido novo invalida os anteriores.
      await tx`UPDATE password_resets SET usado_em = now() WHERE user_id = ${u.id} AND usado_em IS NULL`;
      await tx`
        INSERT INTO password_resets (user_id, token_hash, codigo_hash, expira_em, codigo_expira_em, ip)
        VALUES (${u.id}, ${sha256(token)}, ${sha256(`${u.id}:${codigo}`)},
          now() + make_interval(mins => ${LINK_MIN}), now() + make_interval(mins => ${CODIGO_MIN}), ${ip.slice(0, 45)})
      `;
    });

    // Sem esperar o SMTP: o tempo de resposta nao denuncia se a conta existe.
    void this.enviar(ctx, u, token, codigo, ip, userAgent);
  }

  private async enviar(
    ctx: ReturnType<typeof requireTenantContext>,
    u: { id: string; nome: string; email: string },
    token: string,
    codigo: string,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    const r = await this.email.enviar({
      tenantId: ctx.tenantId,
      para: u.email,
      remetente: ctx.nome,
      assunto: 'Recuperação de senha do jDoc',
      paragrafos: [
        `Olá, ${u.nome}.`,
        `Recebemos um pedido para criar uma nova senha no jDoc de ${ctx.nome}. Use o botão abaixo (vale por ${LINK_MIN} minutos) ou digite o código na tela de recuperação (vale por ${CODIGO_MIN} minutos).`,
        'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
      ],
      codigo,
      botao: { texto: 'Criar nova senha', url: this.email.urlApp(`/${ctx.slug}/redefinir-senha?token=${token}`) },
    });
    if (!r.enviado) this.logger.warn(`Recuperacao de senha em ${ctx.slug} sem envio: ${r.motivo}`);
    // Fora do contexto da requisicao: grava direto no schema do orgao.
    await this.db.tenant(ctx.schemaName)`
      INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, ip, user_agent, metadata)
      VALUES (${u.id}, 'senha_recuperacao_solicitada', 'user', ${u.id}, ${ip}, ${userAgent}, ${JSON.stringify({ emailEnviado: r.enviado })})
    `.catch((e: Error) => this.logger.error(`Falha ao auditar recuperacao: ${e.message}`));
  }

  /** O link ainda vale? (a tela mostra o formulario ou o aviso de link vencido). */
  async validarToken(token: string): Promise<boolean> {
    const ctx = requireTenantContext();
    const [r] = await this.db.tenant(ctx.schemaName)`
      SELECT 1 FROM password_resets WHERE token_hash = ${sha256(token)} AND usado_em IS NULL AND expira_em > now()
    `;
    return !!r;
  }

  async redefinir(input: RedefinirSenhaInput, ip: string, userAgent: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    let reset: { id: string; user_id: string } | undefined;
    if ('token' in input) {
      [reset] = await sql<Array<{ id: string; user_id: string }>>`
        SELECT id, user_id FROM password_resets WHERE token_hash = ${sha256(input.token)} AND usado_em IS NULL AND expira_em > now()
      `;
    } else {
      const u = await this.acharUsuario(input.identificador);
      if (u) {
        const [ultimo] = await sql<Array<{ id: string; user_id: string; codigo_hash: string; tentativas: number }>>`
          SELECT id, user_id, codigo_hash, tentativas FROM password_resets
          WHERE user_id = ${u.id} AND usado_em IS NULL AND codigo_expira_em > now()
          ORDER BY criado_em DESC LIMIT 1
        `;
        if (ultimo && ultimo.tentativas < MAX_TENTATIVAS) {
          const ok = timingSafeEqual(Buffer.from(ultimo.codigo_hash), Buffer.from(sha256(`${u.id}:${input.codigo}`)));
          if (ok) reset = ultimo;
          else {
            await sql`UPDATE password_resets SET tentativas = tentativas + 1 WHERE id = ${ultimo.id}`;
            if (ultimo.tentativas + 1 >= MAX_TENTATIVAS) await sql`UPDATE password_resets SET usado_em = now() WHERE id = ${ultimo.id}`;
          }
        }
      }
    }
    if (!reset) throw new BadRequestException({ message: INVALIDO, code: 'recuperacao_invalida' });

    const hash = await this.passwords.hash(input.novaSenha);
    const [u] = await sql.begin(async (tx) => {
      await tx`UPDATE password_resets SET usado_em = now() WHERE user_id = ${reset!.user_id} AND usado_em IS NULL`;
      return tx<Array<{ email: string }>>`
        UPDATE users SET senha_hash = ${hash}, must_change_password = false, atualizado_em = now()
        WHERE id = ${reset!.user_id} RETURNING email
      `;
    });
    // Senha nova: sessoes antigas caem e o bloqueio por tentativas e liberado.
    await this.refreshTokens.revokeAllForUser('tenant', reset.user_id);
    if (u) await this.bruteForce.desbloquear(`${ctx.tenantId}:${u.email}`);
    await this.audit.logTenant({
      actorId: reset.user_id,
      action: 'senha_redefinida_por_recuperacao',
      resourceType: 'user',
      resourceId: reset.user_id,
      ip,
      userAgent,
      metadata: { via: 'token' in input ? 'link' : 'codigo' },
    });
  }
}
