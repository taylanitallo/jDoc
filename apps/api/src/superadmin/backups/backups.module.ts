import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.service';
import { SuperadminAuthModule } from '../../superadmin-auth/superadmin-auth.module';
import { SuperadminModule } from '../superadmin.module';
import { BackupsService } from './backups.service';
import { BackupsWorker } from './backups.worker';
import { BackupsController } from './backups.controller';

/**
 * O arquivo de backup agora passa pelo StorageService (mesmo caminho dos
 * documentos — Supabase em producao, disco local so em dev), entao nao
 * precisa mais de um controller de arquivo dedicado: o download usa a
 * signed URL do proprio StorageService (ou /files/:slug/:key generico).
 */
@Module({
  imports: [DatabaseModule, SuperadminAuthModule, SuperadminModule],
  controllers: [BackupsController],
  providers: [BackupsService, BackupsWorker],
  exports: [BackupsService],
})
export class BackupsModule {}