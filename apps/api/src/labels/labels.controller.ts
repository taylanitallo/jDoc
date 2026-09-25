import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
  labelsImportsQuerySchema,
  labelsUploadFieldsSchema,
  type LabelsImportView,
  type LabelsImportsQuery,
  type LabelsPreview,
  type LabelsUploadFields,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { LabelsService } from './labels.service';

const uuidSchema = z.string().uuid();

/**
 * Importacao de etiquetas (SS/ASPEC/JBS).
 * Permissao por modulo e dinamica no service (`${module}:create`).
 */
@Controller('t/:slug/labels-imports')
@RequerSistema('financeiro')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  /** Preview: parse + validacao + relatorio de erros. NADA e gravado. */
  @Permissions()
  @Post('preview')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  preview(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(labelsUploadFieldsSchema)) fields: LabelsUploadFields,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<LabelsPreview> {
    if (!file) throw new BadRequestException('Arquivo de etiquetas obrigatorio');
    return this.labels.preview(user, fields, file);
  }

  /** Confirmacao: grava labels_imports + enfileira no BullMQ. */
  @Permissions()
  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  enqueue(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(labelsUploadFieldsSchema)) fields: LabelsUploadFields,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    if (!file) throw new BadRequestException('Arquivo de etiquetas obrigatorio');
    return this.labels.enqueue(user, fields, file, req.ip ?? '');
  }

  @Permissions()
  @Get()
  list(
    @Query(new ZodValidationPipe(labelsImportsQuerySchema)) q: LabelsImportsQuery,
  ): Promise<{ items: LabelsImportView[]; total: number }> {
    return this.labels.list(q);
  }

  /** Status para polling em tempo real. */
  @Permissions()
  @Get(':id')
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<LabelsImportView> {
    return this.labels.get(id);
  }
}
