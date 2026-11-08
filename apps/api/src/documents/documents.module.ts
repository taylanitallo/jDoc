import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignatureModule } from '../signature/signature.module';
import { ConferenciaModule } from '../conferencia/conferencia.module';
import { ArquivisticaModule } from '../arquivistica/arquivistica.module';
import { OcrModule } from '../ocr/ocr.module';
import { DocumentsService } from './documents.service';
import { DocumentsController, TenantLookupsController } from './documents.controller';
import { CompartilhamentoController } from './compartilhamento.controller';
import { CompartilhamentoService } from './compartilhamento.service';

@Module({
  imports: [AuthModule, SignatureModule, ConferenciaModule, ArquivisticaModule, OcrModule],
  controllers: [DocumentsController, TenantLookupsController, CompartilhamentoController],
  providers: [DocumentsService, CompartilhamentoService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
