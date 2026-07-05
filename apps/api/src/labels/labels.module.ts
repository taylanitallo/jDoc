import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabelsService } from './labels.service';
import { LabelsWorker } from './labels.worker';
import { LabelsController } from './labels.controller';

@Module({
  imports: [AuthModule],
  controllers: [LabelsController],
  providers: [LabelsService, LabelsWorker],
})
export class LabelsModule {}
