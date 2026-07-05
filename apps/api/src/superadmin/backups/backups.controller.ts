import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  type BackupTriggerResponse,
  type BackupView,
  type BackupsListResponse,
  type CreateBackupInput,
  type SuperadminAccessClaims,
  createBackupSchema,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SuperadminJwtGuard } from '../../superadmin-auth/superadmin-jwt.guard';
import { BackupsService } from './backups.service';

const uuidSchema = z.string().uuid();

/**
 * Painel superadmin — BACKUPS.
 * Todas as rotas exigem JWT do realm superadmin (guard aplica).
 * Rotas:
 *  - GET  /superadmin/backups            lista (filtro opcional ?tenantId=)
 *  - POST /superadmin/backups            dispara backup { tenantId }
 *  - GET  /superadmin/backups/:id        detalhe
 *  - POST /superadmin/backups/:id/download  retorna URL assinada HMAC 60s
 */
@Controller('superadmin/backups')
@UseGuards(SuperadminJwtGuard)
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list(@Query('tenantId') tenantId?: string): Promise<BackupsListResponse> {
    const parsed = tenantId ? uuidSchema.safeParse(tenantId) : null;
    if (parsed && !parsed.success) {
      return Promise.resolve({ items: [], total: 0 });
    }
    return this.backups.list(parsed?.data);
  }

  @Post()
  @HttpCode(201)
  async trigger(
    @Body(new ZodValidationPipe(createBackupSchema)) body: CreateBackupInput,
    @Req() req: Request,
  ): Promise<BackupTriggerResponse> {
    const user = (req as Request & { user?: SuperadminAccessClaims }).user;
    const actorId = user?.sub ?? '';
    const result = await this.backups.trigger(body.tenantId, actorId);
    return { id: result.id, status: 'pendente' };
  }

  @Get(':id')
  detail(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<BackupView> {
    return this.backups.detail(id);
  }

  @Post(':id/download')
  @HttpCode(200)
  download(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.backups.signedDownloadUrl(id);
  }
}