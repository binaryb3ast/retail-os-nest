import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { BranchMembershipsModule } from '../branch-memberships/branch-memberships.module';
import { BranchesModule } from '../branches/branches.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { UserManagementModule } from '../user-management/user-management.module';
import {
  RoleAssignmentRecord,
  RoleAssignmentSchema,
} from './role-assignment.schema';
import { RoleAssignmentsService } from './role-assignments.service';
import { RolesModule } from './roles.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    BranchesModule,
    BranchMembershipsModule,
    UserManagementModule,
    RolesModule,
    MongooseModule.forFeature([
      { name: RoleAssignmentRecord.name, schema: RoleAssignmentSchema },
    ]),
  ],
  providers: [RoleAssignmentsService],
  exports: [RoleAssignmentsService],
})
export class RoleAssignmentsModule {}
