import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { TenantAccessClaims } from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { SignatureService, type SignatureDetailView } from './signature.service';

const uuidSchema = z.string().uuid();

/** Detalhe da assinatura de um documento. */
@Controller('t/:slug/documents')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class SignatureController {
  constructor(private readonly signature: SignatureService) {}

  @Permissions()
  @Get(':id/signature')
  detail(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<SignatureDetailView> {
    return this.signature.getDetail(user, id);
  }
}
