import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AtendimentoService } from './atendimento.service';
import { AtendimentoController } from './atendimento.controller';

@Module({
  imports: [AuthModule],
  controllers: [AtendimentoController],
  providers: [AtendimentoService],
})
export class AtendimentoModule {}
