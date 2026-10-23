import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DigitalizacaoService } from './digitalizacao.service';
import { DigitalizacaoController } from './digitalizacao.controller';

@Module({
  imports: [AuthModule],
  controllers: [DigitalizacaoController],
  providers: [DigitalizacaoService],
})
export class DigitalizacaoModule {}
