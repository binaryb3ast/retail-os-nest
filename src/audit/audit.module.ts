import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequestContextModule } from '../core/request-context/request-context.module';
import { AuditEventRecord, AuditEventSchema } from './audit-event.schema';
import { AuditService } from './audit.service';

@Module({
  imports: [
    RequestContextModule,
    MongooseModule.forFeature([
      { name: AuditEventRecord.name, schema: AuditEventSchema },
    ]),
  ],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
