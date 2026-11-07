import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { RoleRecord, RoleSchema } from './role.schema';
import { RolesService } from './roles.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    MongooseModule.forFeature([{ name: RoleRecord.name, schema: RoleSchema }]),
  ],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
