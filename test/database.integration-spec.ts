import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { getConnectionToken } from '@nestjs/mongoose';
import { Exclude, Expose } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';
import mongoose, { type Connection } from 'mongoose';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { DatabaseTransactionService } from '../src/infrastructure/database/database-transaction.service';
import { configureApplication } from '../src/core/bootstrap/configure-application';
import { ApplicationException } from '../src/core/errors/application.exception';
import { RequestContextModule } from '../src/core/request-context/request-context.module';
import { RequestContextService } from '../src/core/request-context/request-context.service';

class ProbeRequestDto {
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;
}

@Exclude()
class ProbeResponseDto {
  @Expose()
  email!: string;

  @Expose()
  name!: string;

  @Expose()
  id!: string;

  passwordHash = 'must-not-serialize';
}

@Exclude()
class ProbeContextDto {
  @Expose()
  requestId!: string;

  @Expose()
  correlationId!: string;
}

@Controller({ path: 'probe', version: '1' })
class InfrastructureProbeController {
  constructor(private readonly context: RequestContextService) {}

  @Get('context')
  getContext(): ProbeContextDto {
    const current = this.context.current();
    const result = new ProbeContextDto();
    result.requestId = current?.requestId ?? 'missing';
    result.correlationId = current?.correlationId ?? 'missing';
    return result;
  }

  @Post()
  validateAndSerialize(@Body() input: ProbeRequestDto): ProbeResponseDto {
    const result = new ProbeResponseDto();
    result.email = input.email;
    result.name = input.name;
    result.id = 'probe-1';
    return result;
  }

  @Get('failure')
  fail(): never {
    throw new ApplicationException(
      'BUSINESS_RULE_VIOLATION',
      422,
      'The probe cannot be completed.',
    );
  }

  @Get('unexpected')
  crash(): never {
    throw new Error('internal detail must remain private');
  }

  @Get('duplicate')
  duplicate(): never {
    const error = new Error('duplicate key details must remain private');
    Object.assign(error, { code: 11000 });
    throw error;
  }

  @Get('cast')
  castFailure(): never {
    throw new mongoose.Error.CastError(
      'ObjectId',
      'secret-value-123',
      'recordId',
    );
  }
}

describe('Application infrastructure integration', () => {
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
      imports: [AppModule, RequestContextModule],
      controllers: [InfrastructureProbeController],
    }).compile();
    app = module.createNestApplication();
    app.enableShutdownHooks();
    configureApplication(app);
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

  it('propagates validated request and correlation identifiers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/context')
      .set('x-request-id', 'req-client.1')
      .set('x-correlation-id', 'workflow-55')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('req-client.1');
    expect(response.headers['x-correlation-id']).toBe('workflow-55');
    expect(response.body).toEqual({
      requestId: 'req-client.1',
      correlationId: 'workflow-55',
    });

    const replaced = await request(app.getHttpServer())
      .get('/api/v1/probe/context')
      .set('x-request-id', 'invalid id')
      .expect(200);
    expect(replaced.headers['x-request-id']).not.toBe('invalid id');
    expect(replaced.body).toMatchObject({
      requestId: replaced.headers['x-request-id'],
    });
  });

  it('rejects unknown input and returns the standard field error contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/probe')
      .send({ email: 'not-an-email', name: 'Test', extra: 'not-allowed' })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      requestId: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).toContain('INVALID_FORMAT');
    expect(JSON.stringify(response.body)).toContain('UNKNOWN_FIELD');
    expect(JSON.stringify(response.body)).toContain('email');
    expect(JSON.stringify(response.body)).toContain('extra');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('serializes only explicitly exposed response fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/probe')
      .send({ email: 'person@example.test', name: 'Example' })
      .expect(201)
      .expect({ email: 'person@example.test', name: 'Example', id: 'probe-1' });
  });

  it('returns safe Problem Details for expected and unexpected errors', async () => {
    const expected = await request(app.getHttpServer())
      .get('/api/v1/probe/failure')
      .expect(422)
      .expect('Content-Type', /application\/problem\+json/);
    expect(expected.body).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      detail: 'The probe cannot be completed.',
    });

    const unexpected = await request(app.getHttpServer())
      .get('/api/v1/probe/unexpected')
      .expect(500);
    expect(unexpected.body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      detail: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(unexpected.body)).not.toContain(
      'internal detail must remain private',
    );

    const duplicate = await request(app.getHttpServer())
      .get('/api/v1/probe/duplicate')
      .expect(409);
    expect(duplicate.body).toMatchObject({ code: 'RESOURCE_CONFLICT' });
    expect(JSON.stringify(duplicate.body)).not.toContain(
      'duplicate key details',
    );

    const cast = await request(app.getHttpServer())
      .get('/api/v1/probe/cast')
      .expect(400);
    expect(cast.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(JSON.stringify(cast.body)).not.toContain('secret-value-123');
  });

  it('keeps API routes versioned and health routes neutral', async () => {
    await request(app.getHttpServer()).get('/api/v1/').expect(200);
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/api/health/live').expect(404);
    await request(app.getHttpServer()).get('/api/v2/probe/context').expect(404);
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
