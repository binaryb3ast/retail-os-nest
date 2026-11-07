import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { createInterface } from 'node:readline/promises';
import type { Interface } from 'node:readline/promises';
import type { Connection, Model, Types } from 'mongoose';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { CredentialsService } from '../src/credentials/credentials.service';
import { UserCredentialRecord } from '../src/credentials/user-credential.schema';
import { permissionKeys } from '../src/authorization/permissions.registry';
import { RoleAssignmentRecord } from '../src/roles/role-assignment.schema';
import { RoleRecord } from '../src/roles/role.schema';
import { DatabaseTransactionService } from '../src/infrastructure/database/database-transaction.service';
import { normalizeIdentity } from '../src/identities/identity-normalizer';
import { UserIdentityRecord } from '../src/identities/user-identity.schema';
import { UserRecord } from '../src/users/user.schema';

function askHidden(rl: Interface, label: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(
      new Error('Password entry requires an interactive terminal.'),
    );
  }
  process.stdout.write(label);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b')
          value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    input.on('data', onData);
  });
}

function requiredName(value: string, label: string): string {
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > 100)
    throw new Error(`${label} must contain 1 to 100 characters.`);
  return normalized;
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let app:
    | Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
    | undefined;
  try {
    if (!process.stdin.isTTY)
      throw new Error('Run this command from an interactive terminal.');
    const firstName = requiredName(
      await rl.question('First name: '),
      'First name',
    );
    const lastName = requiredName(
      await rl.question('Last name: '),
      'Last name',
    );
    const email = normalizeIdentity(
      'EMAIL',
      await rl.question('Administrator email: '),
    );
    rl.close();
    const password = await askHidden(rl, 'Password (15–128 characters): ');
    const confirmation = await askHidden(rl, 'Confirm password: ');
    if (password !== confirmation)
      throw new Error('The password entries do not match.');

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const connection = app.get<Connection>(getConnectionToken(), {
      strict: false,
    });
    const users = app.get<Model<UserRecord>>(getModelToken(UserRecord.name), {
      strict: false,
    });
    const identities = app.get<Model<UserIdentityRecord>>(
      getModelToken(UserIdentityRecord.name),
      { strict: false },
    );
    const credentials = app.get<Model<UserCredentialRecord>>(
      getModelToken(UserCredentialRecord.name),
      { strict: false },
    );
    const roles = app.get<Model<RoleRecord>>(getModelToken(RoleRecord.name), {
      strict: false,
    });
    const assignments = app.get<Model<RoleAssignmentRecord>>(
      getModelToken(RoleAssignmentRecord.name),
      { strict: false },
    );
    const transactionService = app.get(DatabaseTransactionService, {
      strict: false,
    });
    const credentialService = app.get(CredentialsService, { strict: false });
    const audit = app.get(AuditService, { strict: false });
    const passwordHash =
      await credentialService.hashPasswordForProvisioning(password);
    const actor = { type: 'SYSTEM' as const, label: 'INITIAL_ADMIN_BOOTSTRAP' };
    const markerCollection = connection.db!.collection<{
      _id: string;
      userId: Types.ObjectId;
      completedAt: Date;
    }>('system_bootstrap_markers');

    const admin = await transactionService.execute(async (session) => {
      if (
        await markerCollection.findOne({ _id: 'initial-admin' }, { session })
      ) {
        throw new Error(
          'Initial administrator bootstrap has already completed.',
        );
      }
      const existingRole = await roles
        .findOne({ code: 'SYSTEM_ADMIN' })
        .session(session)
        .lean()
        .exec();
      if (existingRole)
        throw new Error(
          'SYSTEM_ADMIN already exists; refusing to bootstrap over existing authorization data.',
        );
      if (
        await assignments
          .exists({ scope: 'SYSTEM', status: 'ACTIVE' })
          .session(session)
      ) {
        throw new Error(
          'An active system role assignment already exists; refusing initial bootstrap.',
        );
      }

      const [user] = await users.create(
        [
          {
            accountType: 'HUMAN',
            status: 'ACTIVE',
            firstName,
            lastName,
            displayName: null,
            authVersion: 0,
          },
        ],
        { session },
      );
      const [identity] = await identities.create(
        [
          {
            userId: user._id,
            type: 'EMAIL',
            value: email.value,
            normalizedValue: email.normalizedValue,
            isVerified: true,
            verifiedAt: new Date(),
            isPrimary: true,
          },
        ],
        { session },
      );
      await credentials.create(
        [
          {
            userId: user._id,
            passwordHash,
            passwordChangedAt: new Date(),
            failedAttempts: 0,
            lockedUntil: null,
            lastFailedAt: null,
            revision: 1,
          },
        ],
        { session },
      );
      const [role] = await roles.create(
        [
          {
            name: 'System Administrator',
            code: 'SYSTEM_ADMIN',
            description: 'Initial system administrator role',
            permissions: [...permissionKeys],
            isSystem: true,
            isActive: true,
          },
        ],
        { session },
      );
      const [assignment] = await assignments.create(
        [
          {
            userId: user._id,
            roleId: role._id,
            scope: 'SYSTEM',
            branchId: null,
            status: 'ACTIVE',
            assignedByUserId: null,
            assignedAt: new Date(),
            revokedAt: null,
          },
        ],
        { session },
      );
      await markerCollection.insertOne(
        { _id: 'initial-admin', userId: user._id, completedAt: new Date() },
        { session },
      );
      await audit.record(
        {
          action: 'USER.CREATED',
          actor,
          targetType: 'USER',
          targetId: user._id,
          userId: user._id,
          identityType: 'EMAIL',
          newStatus: 'ACTIVE',
        },
        session,
      );
      await audit.record(
        {
          action: 'USER.PASSWORD_SET',
          actor,
          targetType: 'USER',
          targetId: user._id,
          userId: user._id,
        },
        session,
      );
      await audit.record(
        {
          action: 'ROLE.SYSTEM_CREATED',
          actor,
          targetType: 'ROLE',
          targetId: role._id,
          roleCode: role.code,
          newPermissions: role.permissions,
        },
        session,
      );
      await audit.record(
        {
          action: 'ROLE_ASSIGNMENT.CREATED',
          actor,
          targetType: 'ROLE_ASSIGNMENT',
          targetId: assignment._id,
          userId: user._id,
          roleCode: role.code,
          assignmentScope: 'SYSTEM',
          newAssignmentStatus: 'ACTIVE',
        },
        session,
      );
      return user._id.toString();
    });
    process.stdout.write(`Initial administrator created (${admin}).\n`);
  } finally {
    rl.close();
    if (app) await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bootstrap failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
