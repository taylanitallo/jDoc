import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { OcrModule } from '../ocr/ocr.module';
import { AssistenteService } from './assistente.service';
import { AssistenteController } from './assistente.controller';

@Module({
  imports: [AuthModule, DocumentsModule, OcrModule],
  controllers: [AssistenteController],
  providers: [AssistenteService],
})
export class AssistenteModule {}
