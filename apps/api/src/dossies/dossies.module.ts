import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArquivisticaModule } from '../arquivistica/arquivistica.module';
import { DossiesService } from './dossies.service';
import { DossiesController } from './dossies.controller';

@Module({
  imports: [AuthModule, ArquivisticaModule],
  controllers: [DossiesController],
  providers: [DossiesService],
})
export class DossiesModule {}
