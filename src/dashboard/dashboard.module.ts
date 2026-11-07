import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { BranchesModule } from '../branches/branches.module';
import { RolesModule } from '../roles/roles.module';
import { UserManagementModule } from '../user-management/user-management.module';
import { DashboardController } from './dashboard.controller';
import { AuthenticationController } from '../authentication/authentication.controller';
import { SessionGuard } from '../authentication/session.guard';
import { LoginRateLimitGuard } from '../authentication/login-rate-limit.guard';
import { PermissionGuard } from '../authorization/permission.guard';

@Module({
  imports: [
    AuditModule,
    AuthenticationModule,
    AuthorizationModule,
    BranchesModule,
    RolesModule,
    UserManagementModule,
  ],
  controllers: [DashboardController, AuthenticationController],
  providers: [SessionGuard, LoginRateLimitGuard, PermissionGuard],
})
export class DashboardModule {}
