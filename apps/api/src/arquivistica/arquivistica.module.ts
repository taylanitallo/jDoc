import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArquivisticaService } from './arquivistica.service';
import { ArquivisticaController } from './arquivistica.controller';
import { EliminacaoService } from './eliminacao.service';
import { EliminacaoController } from './eliminacao.controller';

@Module({
  imports: [AuthModule],
  controllers: [ArquivisticaController, EliminacaoController],
  providers: [ArquivisticaService, EliminacaoService],
  exports: [ArquivisticaService],
})
export class ArquivisticaModule {}
