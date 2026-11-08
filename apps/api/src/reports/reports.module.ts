import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.service';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsWorker } from './reports.worker';

@Module({
  imports: [AuthModule, DatabaseModule, AuditModule, StorageModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsWorker],
  exports: [ReportsService],
})
export class ReportsModule {}
