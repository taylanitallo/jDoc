import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.service';
import { SuperadminAuthModule } from '../../superadmin-auth/superadmin-auth.module';
import { SuperadminModule } from '../superadmin.module';
import { BackupsService } from './backups.service';
import { BackupsWorker } from './backups.worker';
import { BackupsController } from './backups.controller';
import { BackupsFilesController } from './backups-files.controller';

@Module({
  imports: [DatabaseModule, SuperadminAuthModule, SuperadminModule],
  controllers: [BackupsController, BackupsFilesController],
  providers: [BackupsService, BackupsWorker],
  exports: [BackupsService],
})
export class BackupsModule {}