import { Global, Module } from '@nestjs/common';
import { IntegracoesService } from './integracoes.service';

/** Global: qualquer modulo resolve a chave efetiva (orgao -> plataforma -> ambiente). */
@Global()
@Module({
  providers: [IntegracoesService],
  exports: [IntegracoesService],
})
export class IntegracoesModule {}
