import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { UserManagementModule } from '../user-management/user-management.module';
import {
  BranchMembershipRecord,
  BranchMembershipSchema,
} from './branch-membership.schema';
import { BranchMembershipsService } from './branch-memberships.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    BranchesModule,
    UserManagementModule,
    MongooseModule.forFeature([
      { name: BranchMembershipRecord.name, schema: BranchMembershipSchema },
    ]),
  ],
  providers: [BranchMembershipsService],
  exports: [BranchMembershipsService],
})
export class BranchMembershipsModule {}
