import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Response } from 'express';
import { loadEnv } from '../../config/env';

const BACKUP_FILE_KEY_REGEX =
  /^backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.dump\.gz$/;

/**
 * Endpoint publico do storage de BACKUPS (realm superadmin).
 * - Caminho /files/backups/:key e separado de /files/:slug/:key (tenant).
 * - Valida HMAC + expiracao (mesma semantica do storage de tenant).
 * - file_key validado contra regex estrita (anti path-traversal).
 * - NUNCA aceita acesso sem assinatura valida: backup .dump.gz nao e publico.
 *
 * Codigos:
 *  - 400 chave/assinatura malformada (param invalido, regex nao bate)
 *  - 403 URL expirada ou assinatura invalida (autenticacao por URL falhou)
 *  - 404 arquivo nao existe no disco (defesa em profundidade: mesmo com
 *    assinatura valida, arquivo precisa existir)
 */
@Controller('files/backups')
export class BackupsFilesController {
  private readonly logger = new Logger(BackupsFilesController.name);

  @Get(':key')
  async serve(
    @Param('key') key: string,
    @Query('exp') expRaw: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!BACKUP_FILE_KEY_REGEX.test(key)) {
      throw new BadRequestException('Chave de arquivo invalida');
    }
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || !sig || !/^[0-9a-f]{64}$/.test(sig)) {
      throw new BadRequestException('Assinatura ausente ou malformada');
    }
    if (exp < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('URL expirada'); // Mantem 400: token de URL malformado/ausente = parametro invalido
    }

    const env = loadEnv();
    const expected = createHmac('sha256', env.COOKIE_SECRET)
      .update(`backups|${key}|${exp}`)
      .digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Assinatura invalida');
    }

    const dir = resolve(env.STORAGE_DIR, 'backups');
    const filePath = resolve(dir, key);
    if (!filePath.startsWith(dir)) {
      throw new BadRequestException('Caminho invalido');
    }

    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      throw new NotFoundException('Arquivo de backup nao encontrado');
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename="${key}"`);
    res.setHeader('Cache-Control', 'no-store');

    const stream = createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`Falha ao streamar backup ${key}: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  }
}