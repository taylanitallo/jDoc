import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { AssistenteService } from './assistente.service';
import { AssistenteController } from './assistente.controller';

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [AssistenteController],
  providers: [AssistenteService],
})
export class AssistenteModule {}
