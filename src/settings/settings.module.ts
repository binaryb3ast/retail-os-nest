import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequestContextModule } from '../core/request-context/request-context.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import {
  SettingAuditRecord,
  SettingAuditSchema,
} from './persistence/setting-audit.schema';
import { SettingRecord, SettingSchema } from './persistence/setting.schema';
import { validateRegistryDefaults } from './registry/settings.registry';
import { SettingsService } from './settings.service';

@Module({
  imports: [
    DatabaseModule,
    RequestContextModule,
    MongooseModule.forFeature([
      { name: SettingRecord.name, schema: SettingSchema },
      { name: SettingAuditRecord.name, schema: SettingAuditSchema },
    ]),
  ],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}

validateRegistryDefaults();
