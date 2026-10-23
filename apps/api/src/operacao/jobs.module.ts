import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';

/** Global: qualquer modulo registra jobs e grava execucoes (backups, correcoes...). */
@Global()
@Module({
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
