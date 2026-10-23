import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminAuthModule } from '../superadmin-auth/superadmin-auth.module';
import { DestinoSegregadoService } from './destino-segregado.service';
import { ContinuidadeService } from './continuidade.service';
import { ExportacaoService } from './exportacao.service';
import { ExportacaoWorker } from './exportacao.worker';
import { ContinuidadeOrgaoController, ContinuidadePlataformaController } from './continuidade.controller';
import { MedicaoService } from './medicao.service';
import { MedicaoOrgaoController, MedicaoPlataformaController } from './medicao.controller';

@Module({
  imports: [AuthModule, SuperadminAuthModule],
  controllers: [ContinuidadeOrgaoController, ContinuidadePlataformaController, MedicaoPlataformaController, MedicaoOrgaoController],
  providers: [DestinoSegregadoService, ContinuidadeService, ExportacaoService, ExportacaoWorker, MedicaoService],
  exports: [ContinuidadeService],
})
export class ContinuidadeModule {}
