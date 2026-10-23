import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { SuperadminAuthModule } from '../superadmin-auth/superadmin-auth.module';
import { BackupsModule } from '../superadmin/backups/backups.module';
import { MetricasMiddleware, MetricasService } from './metricas.service';
import { CorrecoesService } from './correcoes.service';
import { OperacaoController } from './operacao.controller';

@Module({
  imports: [SuperadminAuthModule, BackupsModule],
  controllers: [OperacaoController],
  providers: [MetricasService, CorrecoesService, MetricasMiddleware],
  exports: [MetricasService],
})
export class OperacaoModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Toda requisicao entra no monitoramento de tempo.
    consumer.apply(MetricasMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
