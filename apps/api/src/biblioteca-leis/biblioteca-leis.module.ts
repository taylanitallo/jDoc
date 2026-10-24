import { Module, type OnModuleInit, Injectable } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminAuthModule } from '../superadmin-auth/superadmin-auth.module';
import { JobsService } from '../operacao/jobs.service';
import { BibliotecaLeisService } from './biblioteca-leis.service';
import { LeisSyncService } from './leis-sync.service';
import { BibliotecaLeisController, BibliotecaLeisPlataformaController } from './biblioteca-leis.controller';

/** Liga a sincronizacao ao agendador (todo dia, ver AGENDA em jobs.service) e ao "Executar agora". */
@Injectable()
class BibliotecaLeisJob implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly sync: LeisSyncService,
  ) {}

  onModuleInit(): void {
    this.jobs.registrar('biblioteca_leis', async () => {
      const r = await this.sync.sincronizar({ limite: 30_000 });
      const partes = [`${r.novos} nova(s)`, `${r.atualizados} alterada(s)`, `${r.removidos} removida(s)`];
      if (r.falhas) partes.push(`${r.falhas} falha(s)`);
      if (r.incompleto) partes.push('continua na próxima execução');
      return { resumo: `${partes.join(', ')} em ${r.prefixos.length} pasta(s)`, ...r };
    });
  }
}

@Module({
  imports: [AuthModule, SuperadminAuthModule],
  controllers: [BibliotecaLeisController, BibliotecaLeisPlataformaController],
  providers: [BibliotecaLeisService, LeisSyncService, BibliotecaLeisJob],
  exports: [LeisSyncService],
})
export class BibliotecaLeisModule {}
