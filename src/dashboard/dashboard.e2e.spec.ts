import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
// Supertest's CommonJS export is callable and does not expose an ESM default.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { CredentialsService } from '../credentials/credentials.service';
import { UserCredentialRecord } from '../credentials/user-credential.schema';
import { permissionKeys } from '../authorization/permissions.registry';
import { RoleAssignmentRecord } from '../roles/role-assignment.schema';
import { RoleRecord } from '../roles/role.schema';
import { configureApplication } from '../core/bootstrap/configure-application';
import { ConfigService } from '@nestjs/config';
import { configureDashboardAssets } from './configure-dashboard-assets';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { UserIdentityRecord } from '../identities/user-identity.schema';
import { UserRecord } from '../users/user.schema';

jest.setTimeout(120_000);

describe('admin dashboard HTTP flow', () => {
  const testEmail = 'dashboard.admin@example.com';
  const testPassword = 'Dashboard-flow-password-9382!';
  const previousMongoUri = process.env.MONGODB_URI;
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;

  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replicaSet.getUri();
    const { AppModule } = await import('../app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    configureDashboardAssets(app, app.get(ConfigService));
    await app.init();

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
    const credentialService = app.get(CredentialsService);
    const transactionService = app.get(DatabaseTransactionService);
    const userId = new Types.ObjectId();
    const passwordHash =
      await credentialService.hashPasswordForProvisioning(testPassword);

    await transactionService.execute(async (session) => {
      const [user] = await users.create(
        [
          {
            _id: userId,
            accountType: 'HUMAN',
            status: 'ACTIVE',
            firstName: 'Dashboard',
            lastName: 'Administrator',
            displayName: null,
            authVersion: 0,
          },
        ],
        { session },
      );
      await identities.create(
        [
          {
            userId: user._id,
            type: 'EMAIL',
            value: testEmail,
            normalizedValue: testEmail,
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
            name: 'Dashboard Test Administrator',
            code: 'DASHBOARD_TEST_ADMIN',
            description: null,
            permissions: [...permissionKeys],
            isSystem: true,
            isActive: true,
          },
        ],
        { session },
      );
      await assignments.create(
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
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (replicaSet) await replicaSet.stop();
    if (previousMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousMongoUri;
  });

  it('logs in, reads protected data, performs an admin action, and logs out', async () => {
    const server = app.getHttpServer() as Server;
    await request(server)
      .get('/')
      .expect(302)
      .expect('Location', '/login.html');
    const page = await request(server).get('/login.html').expect(200);
    expect(page.text).toContain('id="loginForm"');
    expect(page.text).toContain('href="/login.css"');
    expect(page.text).toContain('src="/login.js"');
    await request(server).get('/login.css').expect(200);
    const loginScript = await request(server).get('/login.js').expect(200);
    expect(loginScript.text).toContain('http://localhost:3000/api/v1');
    expect(loginScript.text).toContain(
      'ایمیل/نام کاربری یا رمز عبور نادرست است.',
    );
    expect(loginScript.text).toContain(
      "window.location.assign('/admin/main.html')",
    );
    await request(server)
      .get('/admin/main.html')
      .expect(200)
      .expect(/Enterprise Dashboard/);
    await request(server)
      .get('/admin/config.json')
      .expect(200)
      .expect({ apiBase: 'http://localhost:3000/api/v1' });
    const invalidLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({
        identityType: 'EMAIL',
        identityValue: testEmail,
        password: 'incorrect-password',
      })
      .expect(401);
    const invalidLoginBody = invalidLogin.body as unknown as {
      code: string;
      detail: string;
    };
    expect(invalidLoginBody.code).toBe('AUTHENTICATION_FAILED');
    expect(invalidLoginBody.detail).toBeTruthy();
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({
        identityType: 'EMAIL',
        identityValue: testEmail,
        password: testPassword,
      })
      .expect(200);
    const loginBody = login.body as unknown as { token: string };
    const token = loginBody.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const meBody = me.body as unknown as {
      user: { firstName: string };
      permissions: string[];
    };
    expect(meBody.user.firstName).toBe('Dashboard');
    expect(meBody.permissions).toContain('dashboard.read');

    const summary = await request(server)
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const summaryBody = summary.body as unknown as {
      users: { total: number };
      branches: { total: number };
      activity: unknown[];
    };
    expect(summaryBody.users.total).toBe(1);
    expect(summaryBody.branches.total).toBe(0);
    expect(summaryBody.activity.length).toBeGreaterThan(0);

    const branch = await request(server)
      .post('/api/v1/dashboard/branches')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Branch', code: 'TEST-01' })
      .expect(201);
    const branchBody = branch.body as unknown as { status: string };
    expect(branchBody.status).toBe('ACTIVE');

    await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
