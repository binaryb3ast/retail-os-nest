import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { CoreConfigModule } from './core/config/config.module';
import { CoreModule } from './core/core.module';
import { SettingsModule } from './settings/settings.module';
import { UserManagementModule } from './user-management/user-management.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { BranchesModule } from './branches/branches.module';
import { BranchMembershipsModule } from './branch-memberships/branch-memberships.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    CoreConfigModule,
    CoreModule,
    DatabaseModule,
    SettingsModule,
    UserManagementModule,
    AuthenticationModule,
    BranchesModule,
    BranchMembershipsModule,
    AuthorizationModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
