import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { CredentialsService } from '../credentials/credentials.service';
import { UserCredentialRecord, UserCredentialSchema } from '../credentials/user-credential.schema';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { UserManagementModule } from '../user-management/user-management.module';
import { UserSessionRecord, UserSessionSchema } from '../sessions/user-session.schema';
import { SessionsService } from '../sessions/sessions.service';
import { AuthenticationService } from './authentication.service';
import { SessionGuard } from './session.guard';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    UserManagementModule,
    MongooseModule.forFeature([
      { name: UserCredentialRecord.name, schema: UserCredentialSchema },
      { name: UserSessionRecord.name, schema: UserSessionSchema },
    ]),
  ],
  providers: [CredentialsService, SessionsService, AuthenticationService, SessionGuard],
  exports: [SessionGuard],
})
export class AuthenticationModule {}
