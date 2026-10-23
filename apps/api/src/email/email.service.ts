import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { criarTransporteSmtp, IntegracoesService } from '../integracoes/integracoes.service';

export interface Mensagem {
  /** Orgao dono do envio (usa o SMTP dele, se tiver); null = plataforma. */
  tenantId: string | null;
  para: string;
  assunto: string;
  /** Paragrafos do corpo (texto puro; o HTML e montado aqui, com escape). */
  paragrafos: string[];
  /** Botao principal opcional. */
  botao?: { texto: string; url: string };
  /** Codigo em destaque (ex.: codigo de redefinicao). */
  codigo?: string;
  /** Assinatura no topo do e-mail (nome do orgao). */
  remetente?: string;
}

export interface ResultadoEnvio {
  enviado: boolean;
  /** Motivo quando nao enviou (sem SMTP, falha do servidor...). */
  motivo?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Envio de e-mail pelo SMTP configurado no superadmin (do orgao ou o padrao
 * da plataforma). Sem SMTP, nao lanca: devolve `enviado: false` para o
 * chamador decidir (ex.: mostrar a senha provisoria na tela).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly integracoes: IntegracoesService) {}

  async configurado(tenantId: string | null): Promise<boolean> {
    return !!(await this.integracoes.resolver(tenantId, 'email_smtp'));
  }

  async enviar(m: Mensagem): Promise<ResultadoEnvio> {
    const smtp = await this.integracoes.resolver(m.tenantId, 'email_smtp');
    if (!smtp) return { enviado: false, motivo: 'Servidor de e-mail não configurado' };
    const nome = String(smtp.config.remetenteNome || 'jDoc');
    const de = String(smtp.config.remetenteEmail || smtp.config.usuario || '');
    if (!de) return { enviado: false, motivo: 'E-mail do remetente não configurado' };
    let transporte;
    try {
      transporte = criarTransporteSmtp(smtp);
      await transporte.sendMail({
        from: { name: nome, address: de },
        to: m.para,
        subject: m.assunto,
        text: this.texto(m),
        html: this.html(m),
      });
      return { enviado: true };
    } catch (e) {
      this.logger.error(`Falha ao enviar e-mail "${m.assunto}": ${(e as Error).message}`);
      return { enviado: false, motivo: 'O servidor de e-mail recusou o envio' };
    } finally {
      transporte?.close();
    }
  }

  private texto(m: Mensagem): string {
    return [
      ...m.paragrafos,
      ...(m.codigo ? [`Código: ${m.codigo}`] : []),
      ...(m.botao ? [`${m.botao.texto}: ${m.botao.url}`] : []),
      '',
      'JEOS SISTEMAS E ASSESSORIAS LTDA — https://www.jeossistemas.com',
    ].join('\n\n');
  }

  /** HTML simples, com estilos inline (clientes de e-mail ignoram <style>). */
  private html(m: Mensagem): string {
    const p = m.paragrafos.map((t) => `<p style="margin:0 0 14px;line-height:1.55">${esc(t)}</p>`).join('');
    const codigo = m.codigo
      ? `<p style="margin:20px 0;font-size:28px;font-weight:800;letter-spacing:8px;color:#0f172a;text-align:center">${esc(m.codigo)}</p>`
      : '';
    const botao = m.botao
      ? `<p style="margin:24px 0;text-align:center"><a href="${esc(m.botao.url)}" style="display:inline-block;background:#2547eb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(m.botao.texto)}</a></p>
         <p style="margin:0 0 14px;font-size:12px;color:#64748b;word-break:break-all">Se o botão não funcionar, copie o endereço: ${esc(m.botao.url)}</p>`
      : '';
    return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f8fb;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
<tr><td style="padding:24px 28px 8px;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em">${esc(m.remetente ?? 'jDoc')}</td></tr>
<tr><td style="padding:8px 28px 24px;font-size:15px">${p}${codigo}${botao}</td></tr>
</table>
<p style="font-size:12px;color:#64748b;margin:16px 0 0">© ${new Date().getFullYear()} <a href="https://www.jeossistemas.com" style="color:#64748b">JEOS SISTEMAS E ASSESSORIAS LTDA</a></p>
</td></tr></table></body></html>`;
  }

  /** Endereco do front (links dos e-mails). */
  urlApp(caminho: string): string {
    return `${loadEnv().FRONTEND_URL.replace(/\/$/, '')}${caminho}`;
  }
}

@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
