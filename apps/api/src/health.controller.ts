import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
