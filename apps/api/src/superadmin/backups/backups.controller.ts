import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import {
  type BackupTriggerResponse,
  type BackupView,
  type BackupsListResponse,
  type CreateBackupInput,
  type SuperadminAccessClaims,
  type TenantBackupSettings,
  type UpdateBackupSettingsInput,
  type RestoreJobView,
  createBackupSchema,
  updateBackupSettingsSchema,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SuperadminJwtGuard } from '../../superadmin-auth/superadmin-jwt.guard';
import { BackupsService } from './backups.service';

const uuidSchema = z.string().uuid();
const MAX_RESTORE_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — dump relacional, nao os PDFs

function actorAndIp(req: Request): { actorId: string; ip: string } {
  const user = (req as Request & { user?: SuperadminAccessClaims }).user;
  return { actorId: user?.sub ?? '', ip: req.ip ?? '' };
}

/**
 * Painel superadmin — BACKUPS.
 * Todas as rotas exigem JWT do realm superadmin (guard aplica).
 */
@Controller('superadmin/backups')
@UseGuards(SuperadminJwtGuard)
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list(@Query('tenantId') tenantId?: string): Promise<BackupsListResponse> {
    const parsed = tenantId ? uuidSchema.safeParse(tenantId) : null;
    if (parsed && !parsed.success) return Promise.resolve({ items: [], total: 0 });
    return this.backups.list(parsed?.data);
  }

  @Post()
  @HttpCode(201)
  async trigger(
    @Body(new ZodValidationPipe(createBackupSchema)) body: CreateBackupInput,
    @Req() req: Request,
  ): Promise<BackupTriggerResponse> {
    const { actorId } = actorAndIp(req);
    const result = await this.backups.trigger(body.tenantId, actorId);
    return { id: result.id, status: 'pendente' };
  }

  @Get('settings/:tenantId')
  getSettings(
    @Param('tenantId', new ZodValidationPipe(uuidSchema)) tenantId: string,
  ): Promise<TenantBackupSettings> {
    return this.backups.getSettings(tenantId);
  }

  @Patch('settings/:tenantId')
  async updateSettings(
    @Param('tenantId', new ZodValidationPipe(uuidSchema)) tenantId: string,
    @Body(new ZodValidationPipe(updateBackupSettingsSchema)) body: UpdateBackupSettingsInput,
    @Req() req: Request,
  ): Promise<TenantBackupSettings> {
    const { actorId, ip } = actorAndIp(req);
    return this.backups.updateSettings(tenantId, body, actorId, ip);
  }

  @Post('restore')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  async restore(
    @Body('tenantId', new ZodValidationPipe(uuidSchema)) tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    if (!file) throw new BadRequestException('Arquivo de backup obrigatorio');
    if (file.size > MAX_RESTORE_UPLOAD_BYTES) {
      throw new BadRequestException('Arquivo excede o limite de 20MB para restauracao');
    }
    const { actorId } = actorAndIp(req);
    return this.backups.triggerRestore(tenantId, file.buffer, actorId);
  }

  @Get('restore/:id')
  restoreDetail(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<RestoreJobView> {
    return this.backups.restoreDetail(id);
  }

  @Delete('history')
  @HttpCode(200)
  clearHistory(
    @Query('tenantId', new ZodValidationPipe(uuidSchema)) tenantId: string,
    @Req() req: Request,
  ): Promise<{ count: number }> {
    const { actorId, ip } = actorAndIp(req);
    return this.backups.clearHistory(tenantId, actorId, ip);
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

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    const { actorId, ip } = actorAndIp(req);
    await this.backups.remove(id, actorId, ip);
  }
}
