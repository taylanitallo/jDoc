import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.service';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsWorker } from './reports.worker';

@Module({
  imports: [JwtModule, DatabaseModule, AuditModule, StorageModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsWorker],
  exports: [ReportsService],
})
export class ReportsModule {}
