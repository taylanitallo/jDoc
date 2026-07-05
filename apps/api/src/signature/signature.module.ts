import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignatureService } from './signature.service';
import { SignatureWorker } from './signature.worker';
import { SignatureController } from './signature.controller';

@Module({
  imports: [AuthModule],
  controllers: [SignatureController],
  providers: [SignatureService, SignatureWorker],
  exports: [SignatureService],
})
export class SignatureModule {}
