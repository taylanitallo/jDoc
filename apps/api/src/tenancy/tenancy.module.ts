import { Global, Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { TenancyMiddleware } from './tenancy.middleware';

@Global()
@Module({
  providers: [TenancyService, TenancyMiddleware],
  exports: [TenancyService, TenancyMiddleware],
})
export class TenancyModule {}
