import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { type Connection } from 'mongoose';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { DatabaseTransactionService } from '../src/infrastructure/database/database-transaction.service';

describe('MongoDB infrastructure integration', () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let connection: Connection;
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME,
  };

  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = replicaSet.getUri();
    process.env.MONGODB_DB_NAME = 'retail_os_integration';

    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
  }, 120000);

  afterAll(async () => {
    if (app) await app.close();
    if (replicaSet) await replicaSet.stop();

    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30000);

  it('serves database readiness and supports replica set transactions', async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });

    await request(app.getHttpServer())
      .get('/health/database')
      .expect(200)
      .expect({ status: 'ok', database: 'connected' });

    const transactions = app.get(DatabaseTransactionService);
    const collection = connection.db?.collection('infrastructure_probe');
    if (!collection) throw new Error('Integration database is not available');

    const insertedId = await transactions.execute(async (session) => {
      const result = await collection.insertOne({ checked: true }, { session });
      return result.insertedId;
    });

    expect(await collection.countDocuments({ _id: insertedId })).toBe(1);
  });

  it('closes the shared MongoDB connection during application shutdown', async () => {
    await app.close();
    expect(connection.readyState).toBe(0);
  });

  it('fails connection attempts within the configured server selection bound', async () => {
    const failedConnection = mongoose.createConnection(
      'mongodb://127.0.0.1:1/unreachable',
      { serverSelectionTimeoutMS: 200, connectTimeoutMS: 200 },
    );

    await expect(failedConnection.asPromise()).rejects.toThrow();
    await failedConnection.close().catch(() => undefined);
  });
});
