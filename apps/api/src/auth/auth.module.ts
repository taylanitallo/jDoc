import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ImpersonacaoInterceptor } from './impersonacao.interceptor';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CrossTenantLoginController } from './cross-tenant-login.controller';
import { PasswordService } from './password.service';
import { BruteForceService } from './brute-force.service';
import { RefreshTokenService } from './refresh-token.service';
import { TenantJwtGuard } from './tenant-jwt.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, CrossTenantLoginController],
  providers: [
    AuthService,
    PasswordService,
    BruteForceService,
    RefreshTokenService,
    TenantJwtGuard,
    PermissionsGuard,
    { provide: APP_INTERCEPTOR, useClass: ImpersonacaoInterceptor },
  ],
  exports: [
    AuthService,
    PasswordService,
    BruteForceService,
    RefreshTokenService,
    TenantJwtGuard,
    PermissionsGuard,
    JwtModule,
  ],
})
export class AuthModule {}
