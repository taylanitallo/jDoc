import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegridadeService } from './integridade.service';
import { IntegridadeWorker } from './integridade.worker';
import { IntegridadeController } from './integridade.controller';

@Module({
  imports: [AuthModule],
  controllers: [IntegridadeController],
  providers: [IntegridadeService, IntegridadeWorker],
  exports: [IntegridadeService],
})
export class IntegridadeModule {}
