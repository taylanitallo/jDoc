import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RelatoriosArquivoService } from './relatorios-arquivo.service';
import { RelatoriosArquivoController } from './relatorios-arquivo.controller';

@Module({
  imports: [AuthModule],
  controllers: [RelatoriosArquivoController],
  providers: [RelatoriosArquivoService],
})
export class RelatoriosArquivoModule {}
