import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { BranchRecord, BranchSchema } from './branch.schema';
import { BranchesService } from './branches.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    MongooseModule.forFeature([
      { name: BranchRecord.name, schema: BranchSchema },
    ]),
  ],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
