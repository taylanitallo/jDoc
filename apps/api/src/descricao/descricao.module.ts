import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DescricaoService } from './descricao.service';
import { DescricaoController } from './descricao.controller';

@Module({
  imports: [AuthModule],
  controllers: [DescricaoController],
  providers: [DescricaoService],
})
export class DescricaoModule {}
