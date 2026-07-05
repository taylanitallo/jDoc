import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminAuthModule } from '../superadmin-auth/superadmin-auth.module';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { SuperadminController } from './superadmin.controller';
import { SuperadminTenantsService } from './superadmin-tenants.service';
import { SuperadminUsersService } from './superadmin-users.service';
import { SuperadminLogsService, SuperadminDashboardService } from './superadmin-logs.service';

@Module({
  imports: [AuthModule, SuperadminAuthModule, ProvisioningModule],
  controllers: [SuperadminController],
  providers: [
    SuperadminTenantsService,
    SuperadminUsersService,
    SuperadminLogsService,
    SuperadminDashboardService,
  ],
  exports: [SuperadminTenantsService],
})
export class SuperadminModule {}
