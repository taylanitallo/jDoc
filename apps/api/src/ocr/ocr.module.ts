import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OcrService } from './ocr.service';
import { OcrWorker } from './ocr.worker';
import { BuscaService } from './busca.service';
import { BuscaController } from './busca.controller';

@Module({
  imports: [AuthModule],
  controllers: [BuscaController],
  providers: [OcrService, OcrWorker, BuscaService],
  exports: [OcrService, BuscaService],
})
export class OcrModule {}
