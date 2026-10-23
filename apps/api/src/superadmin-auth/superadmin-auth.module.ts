import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { SuperadminAuthService } from './superadmin-auth.service';
import { SuperadminAuthController } from './superadmin-auth.controller';
import { SuperadminJwtGuard } from './superadmin-jwt.guard';
import { AdminSessionsService } from './admin-sessions.service';
import { EquipeService } from './equipe.service';
import { EquipeController } from './equipe.controller';

@Module({
  imports: [JwtModule.register({}), AuthModule],
  controllers: [SuperadminAuthController, EquipeController],
  providers: [
    SuperadminAuthService,
    SuperadminJwtGuard,
    AdminSessionsService,
    EquipeService,
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
  ],
  exports: [SuperadminJwtGuard, JwtModule, AdminSessionsService, EquipeService],
})
export class SuperadminAuthModule {}
