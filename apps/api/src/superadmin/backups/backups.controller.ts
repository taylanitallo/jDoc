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
  TIPOS_BACKUP,
  createBackupSchema,
  limparBackupsSchema,
  restaurarDeBackupSchema,
  updateBackupSettingsSchema,
  type BackupTriggerResponse,
  type BackupView,
  type BackupsListResponse,
  type CreateBackupInput,
  type RestaurarDeBackupInput,
  type RestoreJobView,
  type TenantBackupSettings,
  type UpdateBackupSettingsInput,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Critico, CurrentAdmin, Papeis, type AdminReq } from '../../superadmin-auth/decorators';
import { SuperadminJwtGuard } from '../../superadmin-auth/superadmin-jwt.guard';
import { BackupsService } from './backups.service';

const uuidSchema = z.string().uuid();
const uuid = () => new ZodValidationPipe(uuidSchema);
/** Dump relacional (sem os PDFs): 50 MB sobram. */
const MAX_RESTORE_UPLOAD_BYTES = 50 * 1024 * 1024;
const listaSchema = z
  .object({
    tenantId: z.string().uuid().optional(),
    kind: z.enum(TIPOS_BACKUP).optional(),
    status: z.enum(['pendente', 'processando', 'concluido', 'erro']).optional(),
    completo: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  })
  .strict();

const autor = (a: AdminReq) => ({ id: a.id, nome: a.nome });

/**
 * Backups (realm superadmin). Leitura: owner e suporte; criar, baixar, excluir
 * e agendar: owner; restaurar: owner com reautenticacao.
 */
@Controller('superadmin/backups')
@UseGuards(SuperadminJwtGuard)
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Papeis('owner', 'support')
  @Get()
  list(@Query(new ZodValidationPipe(listaSchema)) q: z.infer<typeof listaSchema>): Promise<BackupsListResponse> {
    return this.backups.list(q);
  }

  @Post()
  @HttpCode(201)
  async trigger(
    @Body(new ZodValidationPipe(createBackupSchema)) body: CreateBackupInput,
    @CurrentAdmin() admin: AdminReq,
  ): Promise<BackupTriggerResponse> {
    const r = await this.backups.trigger(body.tenantId, autor(admin));
    return { id: r.id, status: 'pendente' };
  }

  /** "Backup completo": todo o banco. */
  @Post('completo')
  @HttpCode(201)
  async completo(@CurrentAdmin() admin: AdminReq): Promise<BackupTriggerResponse> {
    const r = await this.backups.triggerCompleto(autor(admin));
    return { id: r.id, status: 'pendente' };
  }

  @Papeis('owner', 'support')
  @Get('settings/:tenantId')
  getSettings(@Param('tenantId', uuid()) tenantId: string): Promise<TenantBackupSettings> {
    return this.backups.getSettings(tenantId);
  }

  @Patch('settings/:tenantId')
  updateSettings(
    @Param('tenantId', uuid()) tenantId: string,
    @Body(new ZodValidationPipe(updateBackupSettingsSchema)) body: UpdateBackupSettingsInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<TenantBackupSettings> {
    return this.backups.updateSettings(tenantId, body, admin.id, req.ip ?? '');
  }

  /** Restaurar enviando um arquivo .dump.gz proprio. */
  @Post('restore')
  @Critico()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  async restore(
    @Body('tenantId', uuid()) tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAdmin() admin: AdminReq,
  ): Promise<{ id: string }> {
    if (!file) throw new BadRequestException('Envie o arquivo de backup');
    if (file.size > MAX_RESTORE_UPLOAD_BYTES) throw new BadRequestException('Arquivo maior que 50 MB');
    return this.backups.triggerRestore(tenantId, file.buffer, autor(admin), file.originalname?.slice(0, 255));
  }

  /** Restaurar a partir de um backup existente do orgao. */
  @Post('restore/de-backup')
  @Critico()
  @HttpCode(201)
  restaurarDeBackup(
    @Body(new ZodValidationPipe(restaurarDeBackupSchema)) body: RestaurarDeBackupInput,
    @CurrentAdmin() admin: AdminReq,
  ): Promise<{ id: string }> {
    return this.backups.restaurarDeBackup(body.tenantId, body.backupId, autor(admin));
  }

  @Papeis('owner', 'support')
  @Get('restore/:id')
  restoreDetail(@Param('id', uuid()) id: string): Promise<RestoreJobView> {
    return this.backups.restoreDetail(id);
  }

  @Delete('history')
  @HttpCode(200)
  clearHistory(@Query('tenantId', uuid()) tenantId: string, @CurrentAdmin() admin: AdminReq, @Req() req: Request): Promise<{ count: number }> {
    return this.backups.clearHistory(tenantId, admin.id, req.ip ?? '');
  }

  /** "Limpar antigos" (todos os orgaos). */
  @Delete('antigos')
  @HttpCode(200)
  limparAntigos(
    @Query(new ZodValidationPipe(limparBackupsSchema)) q: { diasMaisQue: number },
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<{ count: number }> {
    return this.backups.limparAntigos(q.diasMaisQue, admin.id, req.ip ?? '');
  }

  @Papeis('owner', 'support')
  @Get(':id')
  detail(@Param('id', uuid()) id: string): Promise<BackupView> {
    return this.backups.detail(id);
  }

  /** Download auditado (URL assinada de 60 s). */
  @Post(':id/download')
  @HttpCode(200)
  download(@Param('id', uuid()) id: string, @CurrentAdmin() admin: AdminReq, @Req() req: Request): Promise<{ url: string; expiresInSeconds: number }> {
    return this.backups.signedDownloadUrl(id, admin.id, req.ip ?? '');
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', uuid()) id: string, @CurrentAdmin() admin: AdminReq, @Req() req: Request): Promise<void> {
    await this.backups.remove(id, admin.id, req.ip ?? '');
  }
}
