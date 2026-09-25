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
  createTenantSchema,
  updateTenantSchema,
  setTenantStatusSchema,
  setQuotaSchema,
  createTenantUserSchema,
  resetUserPasswordSchema,
  setUserActiveSchema,
  logsQuerySchema,
  type CreateTenantInput,
  type UpdateTenantInput,
  type SetTenantStatusInput,
  type SetQuotaInput,
  type CreateTenantUserInput,
  type ResetUserPasswordInput,
  type SetUserActiveInput,
  type LogsQuery,
  type MasterDashboard,
  type SuperadminAccessClaims,
  type TenantOverview,
  deleteTenantSchema,
  type DeleteTenantInput,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { SuperadminTenantsService } from './superadmin-tenants.service';
import { SuperadminUsersService, type TenantUserView } from './superadmin-users.service';
import {
  SuperadminLogsService,
  SuperadminDashboardService,
  type LogPage,
} from './superadmin-logs.service';

const uuidSchema = z.string().uuid();

function actor(req: Request): { id: string; ip: string } {
  const user = (req as Request & { user?: SuperadminAccessClaims }).user;
  return { id: user?.sub ?? '', ip: req.ip ?? '' };
}

/**
 * Painel superadmin — TODAS as rotas exigem JWT do realm superadmin
 * (issuer/audience proprios) + allowlist de IP opcional. Nenhuma e publica.
 */
@Controller('superadmin')
@UseGuards(SuperadminJwtGuard)
export class SuperadminController {
  constructor(
    private readonly tenants: SuperadminTenantsService,
    private readonly users: SuperadminUsersService,
    private readonly logs: SuperadminLogsService,
    private readonly dash: SuperadminDashboardService,
  ) {}

  // ---- Dashboard master ----

  @Get('dashboard')
  dashboard(): Promise<MasterDashboard> {
    return this.dash.dashboard();
  }

  // ---- Orgaos (tenants) ----

  @Get('tenants')
  listTenants(): Promise<TenantOverview[]> {
    return this.tenants.list();
  }

  @Get('tenants/:id')
  getTenant(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<TenantOverview> {
    return this.tenants.overview(id);
  }

  @Post('tenants')
  @HttpCode(201)
  async createTenant(
    @Body(new ZodValidationPipe(createTenantSchema)) body: CreateTenantInput,
    @Req() req: Request,
  ): Promise<{ id: string; schemaName: string }> {
    const a = actor(req);
    return this.tenants.create(body, a.id, a.ip);
  }

  @Patch('tenants/:id')
  @HttpCode(204)
  async updateTenant(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.update(id, body, a.id, a.ip);
  }

  @Patch('tenants/:id/status')
  @HttpCode(204)
  async setTenantStatus(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(setTenantStatusSchema)) body: SetTenantStatusInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.setStatus(id, body, a.id, a.ip);
  }

  @Patch('tenants/:id/quota')
  @HttpCode(204)
  async setTenantQuota(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(setQuotaSchema)) body: SetQuotaInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.setQuota(id, body, a.id, a.ip);
  }

  @Post('tenants/:id/brasao')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTenantBrasao(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ brasaoUrl: string }> {
    if (!file) throw new BadRequestException('Imagem obrigatória');
    const a = actor(req);
    return this.tenants.uploadBrasao(id, file, a.id, a.ip);
  }

  @Delete('tenants/:id/brasao')
  @HttpCode(204)
  async deleteTenantBrasao(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.deleteBrasao(id, a.id, a.ip);
  }

  @Delete('tenants/:id')
  @HttpCode(204)
  async deleteTenant(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(deleteTenantSchema)) body: DeleteTenantInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.remove(id, body.confirmacao, a.id, a.ip);
  }

  // ---- Usuarios de tenant ----

  @Get('tenants/:id/users')
  listUsers(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<TenantUserView[]> {
    return this.users.list(id);
  }

  @Post('tenants/:id/users')
  @HttpCode(201)
  createUser(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createTenantUserSchema)) body: CreateTenantUserInput,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    const a = actor(req);
    return this.users.create(id, body, a.id, a.ip);
  }

  @Patch('tenants/:id/users/:userId/password')
  @HttpCode(204)
  async resetUserPassword(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('userId', new ZodValidationPipe(uuidSchema)) userId: string,
    @Body(new ZodValidationPipe(resetUserPasswordSchema)) body: ResetUserPasswordInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.users.resetPassword(id, userId, body, a.id, a.ip);
  }

  @Patch('tenants/:id/users/:userId/ativo')
  @HttpCode(204)
  async setUserActive(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('userId', new ZodValidationPipe(uuidSchema)) userId: string,
    @Body(new ZodValidationPipe(setUserActiveSchema)) body: SetUserActiveInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.users.setActive(id, userId, body, a.id, a.ip);
  }

  @Delete('tenants/:id/users/:userId')
  @HttpCode(204)
  async deleteUser(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('userId', new ZodValidationPipe(uuidSchema)) userId: string,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.users.remove(id, userId, a.id, a.ip);
  }

  // ---- Logs ----

  @Get('logs/global')
  globalLogs(@Query(new ZodValidationPipe(logsQuerySchema)) q: LogsQuery): Promise<LogPage> {
    return this.logs.globalLogs(q);
  }

  @Get('tenants/:id/logs')
  tenantLogs(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(logsQuerySchema)) q: LogsQuery,
  ): Promise<LogPage> {
    return this.logs.tenantLogs(id, q);
  }
}
