import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  DatabaseHealthService,
  LivenessStatusDto,
} from './database-health.service';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class DatabaseHealthController {
  constructor(private readonly healthService: DatabaseHealthService) {}

  @Get('live')
  live(): LivenessStatusDto {
    return new LivenessStatusDto();
  }

  @Get('database')
  check() {
    return this.healthService.check();
  }
}
