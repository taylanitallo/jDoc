import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracoesService } from './configuracoes.service';
import { ConfiguracoesController } from './configuracoes.controller';

@Module({
  imports: [AuthModule],
  controllers: [ConfiguracoesController],
  providers: [ConfiguracoesService],
  exports: [ConfiguracoesService],
})
export class ConfiguracoesModule {}
