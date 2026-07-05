import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { SuperadminAuthService } from './superadmin-auth.service';
import { SuperadminAuthController } from './superadmin-auth.controller';
import { SuperadminJwtGuard } from './superadmin-jwt.guard';

@Module({
  imports: [JwtModule.register({}), AuthModule],
  controllers: [SuperadminAuthController],
  providers: [SuperadminAuthService, SuperadminJwtGuard],
  exports: [SuperadminJwtGuard, JwtModule],
})
export class SuperadminAuthModule {}
