import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SignatureModule } from '../signature/signature.module';
import { DocumentsService } from './documents.service';
import { DocumentsController, TenantLookupsController } from './documents.controller';

@Module({
  imports: [AuthModule, SignatureModule],
  controllers: [DocumentsController, TenantLookupsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
