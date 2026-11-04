import { Controller, Get } from '@nestjs/common';
import { DatabaseHealthService } from './database-health.service';

@Controller('health')
export class DatabaseHealthController {
  constructor(private readonly healthService: DatabaseHealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('database')
  check() {
    return this.healthService.check();
  }
}
