import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LegislacaoService } from './legislacao.service';
import { LegislacaoController, LegislacaoPublicaController } from './legislacao.controller';

@Module({
  imports: [AuthModule],
  controllers: [LegislacaoController, LegislacaoPublicaController],
  providers: [LegislacaoService],
})
export class LegislacaoModule {}
