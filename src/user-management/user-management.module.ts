import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { IdentitiesService } from '../identities/identities.service';
import {
  UserIdentityRecord,
  UserIdentitySchema,
} from '../identities/user-identity.schema';
import { UserRecord, UserSchema } from '../users/user.schema';
import { UsersService } from '../users/users.service';

@Injectable()
class UserManagementIndexes implements OnModuleInit {
  constructor(
    @InjectModel(UserRecord.name) private readonly users: Model<UserRecord>,
    @InjectModel(UserIdentityRecord.name)
    private readonly identities: Model<UserIdentityRecord>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.users.createIndexes();
    await this.identities.createIndexes();
  }
}

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    MongooseModule.forFeature([
      { name: UserRecord.name, schema: UserSchema },
      { name: UserIdentityRecord.name, schema: UserIdentitySchema },
    ]),
  ],
  providers: [UserManagementIndexes, UsersService, IdentitiesService],
  exports: [UsersService, IdentitiesService],
})
export class UserManagementModule {}
