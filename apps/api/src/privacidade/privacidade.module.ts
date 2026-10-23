import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminAuthModule } from '../superadmin-auth/superadmin-auth.module';
import { PrivacidadeService } from './privacidade.service';
import { PrivacidadeController, PrivacidadePlataformaController } from './privacidade.controller';

/** Global: assistente e conferencia consultam se o orgao desligou a IA. */
@Global()
@Module({
  imports: [AuthModule, SuperadminAuthModule],
  controllers: [PrivacidadeController, PrivacidadePlataformaController],
  providers: [PrivacidadeService],
  exports: [PrivacidadeService],
})
export class PrivacidadeModule {}
