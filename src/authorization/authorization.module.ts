import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module';
import { BranchMembershipsModule } from '../branch-memberships/branch-memberships.module';
import { BranchesModule } from '../branches/branches.module';
import { UserManagementModule } from '../user-management/user-management.module';
import { RoleAssignmentsModule } from '../roles/role-assignments.module';
import { RolesModule } from '../roles/roles.module';
import { AuthorizationService } from './authorization.service';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [
    AuthenticationModule,
    UserManagementModule,
    BranchesModule,
    BranchMembershipsModule,
    RolesModule,
    RoleAssignmentsModule,
  ],
  providers: [AuthorizationService, PermissionGuard],
  exports: [AuthorizationService, PermissionGuard],
})
export class AuthorizationModule {}
