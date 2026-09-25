import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { AutenticidadeService } from './autenticidade.service';
import { CopiaAutenticadaController, VerificacaoPublicaController } from './autenticidade.controller';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [CopiaAutenticadaController, VerificacaoPublicaController],
  providers: [AutenticidadeService],
})
export class AutenticidadeModule {}
