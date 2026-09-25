import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SigiloService } from './sigilo.service';
import { SigiloController } from './sigilo.controller';

@Module({
  imports: [AuthModule],
  controllers: [SigiloController],
  providers: [SigiloService],
  exports: [SigiloService],
})
export class SigiloModule {}
