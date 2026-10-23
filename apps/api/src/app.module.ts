import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { DatabaseModule } from './database/database.service';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './audit/audit.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { TenancyMiddleware } from './tenancy/tenancy.middleware';
import { ProvisioningModule } from './provisioning/provisioning.module';
import { AuthModule } from './auth/auth.module';
import { SuperadminAuthModule } from './superadmin-auth/superadmin-auth.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { BackupsModule } from './superadmin/backups/backups.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsModule } from './documents/documents.module';
import { SignatureModule } from './signature/signature.module';
import { ConferenciaModule } from './conferencia/conferencia.module';
import { LabelsModule } from './labels/labels.module';
import { ConfiguracoesModule } from './configuracoes/configuracoes.module';
import { ReportsModule } from './reports/reports.module';
import { AssistenteModule } from './assistente/assistente.module';
import { ArquivisticaModule } from './arquivistica/arquivistica.module';
import { OcrModule } from './ocr/ocr.module';
import { AutenticidadeModule } from './autenticidade/autenticidade.module';
import { ArquivoFisicoModule } from './arquivo-fisico/arquivo-fisico.module';
import { IntegridadeModule } from './integridade/integridade.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { PrivacidadeModule } from './privacidade/privacidade.module';
import { DigitalizacaoModule } from './digitalizacao/digitalizacao.module';
import { RelatoriosArquivoModule } from './relatorios-arquivo/relatorios-arquivo.module';
import { AtendimentoModule } from './atendimento/atendimento.module';
import { SigiloModule } from './sigilo/sigilo.module';
import { DossiesModule } from './dossies/dossies.module';
import { DescricaoModule } from './descricao/descricao.module';
import { LegislacaoModule } from './legislacao/legislacao.module';
import { ThrottlerConfigModule } from './common/throttler.module';
import { IntegracoesModule } from './integracoes/integracoes.module';
import { EmailModule } from './email/email.service';
import { JobsModule } from './operacao/jobs.module';
import { OperacaoModule } from './operacao/operacao.module';
import { ChamadosModule } from './chamados/chamados.module';
import { HealthController } from './health.controller';
import { TenantsPublicController } from './tenants-public.controller';

@Module({
  imports: [
    ThrottlerConfigModule,
    RedisModule,
    DatabaseModule,
    AuditModule,
    IntegracoesModule,
    EmailModule,
    JobsModule,
    TenancyModule,
    ProvisioningModule,
    AuthModule,
    SuperadminAuthModule,
    SuperadminModule,
    BackupsModule,
    OperacaoModule,
    ChamadosModule,
    StorageModule,
    DocumentsModule,
    SignatureModule,
    ConferenciaModule,
    LabelsModule,
    ConfiguracoesModule,
    ReportsModule,
    AssistenteModule,
    ArquivisticaModule,
    OcrModule,
    AutenticidadeModule,
    ArquivoFisicoModule,
    IntegridadeModule,
    AuditoriaModule,
    PrivacidadeModule,
    DigitalizacaoModule,
    RelatoriosArquivoModule,
    AtendimentoModule,
    SigiloModule,
    DossiesModule,
    DescricaoModule,
    LegislacaoModule,
  ],
  controllers: [HealthController, TenantsPublicController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // TODA rota de tenant passa pelo middleware de resolucao/isolamento.
    consumer.apply(TenancyMiddleware).forRoutes({ path: 't/:slug/*', method: RequestMethod.ALL });
  }
}
