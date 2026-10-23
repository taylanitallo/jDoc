import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AjudaService } from './ajuda.service';
import { AjudaController } from './ajuda.controller';

@Module({
  imports: [AuthModule],
  controllers: [AjudaController],
  providers: [AjudaService],
})
export class AjudaModule {}
