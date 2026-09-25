import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArquivoFisicoService } from './arquivo-fisico.service';
import { ArquivoFisicoController } from './arquivo-fisico.controller';

@Module({
  imports: [AuthModule],
  controllers: [ArquivoFisicoController],
  providers: [ArquivoFisicoService],
})
export class ArquivoFisicoModule {}
