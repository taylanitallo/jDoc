import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { BruteForceService } from './brute-force.service';
import { RefreshTokenService } from './refresh-token.service';
import { TenantJwtGuard } from './tenant-jwt.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    BruteForceService,
    RefreshTokenService,
    TenantJwtGuard,
    PermissionsGuard,
  ],
  exports: [
    PasswordService,
    BruteForceService,
    RefreshTokenService,
    TenantJwtGuard,
    PermissionsGuard,
    JwtModule,
  ],
})
export class AuthModule {}
