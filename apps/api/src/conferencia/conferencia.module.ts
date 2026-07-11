import { Module } from '@nestjs/common';
import { ConferenciaService } from './conferencia.service';
import { ConferenciaWorker } from './conferencia.worker';

@Module({
  providers: [ConferenciaService, ConferenciaWorker],
  exports: [ConferenciaService],
})
export class ConferenciaModule {}
