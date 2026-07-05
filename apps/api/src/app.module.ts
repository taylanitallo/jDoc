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
import { LabelsModule } from './labels/labels.module';
import { ConfiguracoesModule } from './configuracoes/configuracoes.module';
import { ReportsModule } from './reports/reports.module';
import { ThrottlerConfigModule } from './common/throttler.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ThrottlerConfigModule,
    RedisModule,
    DatabaseModule,
    AuditModule,
    TenancyModule,
    ProvisioningModule,
    AuthModule,
    SuperadminAuthModule,
    SuperadminModule,
    BackupsModule,
    StorageModule,
    DocumentsModule,
    SignatureModule,
    LabelsModule,
    ConfiguracoesModule,
    ReportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // TODA rota de tenant passa pelo middleware de resolucao/isolamento.
    consumer.apply(TenancyMiddleware).forRoutes({ path: 't/:slug/*', method: RequestMethod.ALL });
  }
}
