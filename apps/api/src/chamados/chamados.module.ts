import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminAuthModule } from '../superadmin-auth/superadmin-auth.module';
import { ChamadosService } from './chamados.service';
import { ChamadosAdminController, SuporteController } from './chamados.controller';

@Module({
  imports: [AuthModule, SuperadminAuthModule],
  controllers: [ChamadosAdminController, SuporteController],
  providers: [ChamadosService],
  exports: [ChamadosService],
})
export class ChamadosModule {}
