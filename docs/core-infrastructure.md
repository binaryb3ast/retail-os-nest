# Core application infrastructure

This guide covers the shared NestJS infrastructure for configuration, logging, request context, errors, HTTP contracts, validation, serialization, and API versioning. `CoreConfigModule` is imported once by `AppModule`; `CoreModule` composes the global pipe, serializer, exception filter, request context, and logger. The MongoDB connection remains owned by `DatabaseModule`.

## Configuration

`@nestjs/config` loads `.env` for local work and receives the same values from the deployment environment in other stages. `validateApplicationEnvironment` validates the database settings and core server/logging/API settings before modules are initialized. Config sections are registered as `app`, `server`, `logging`, and `api`; MongoDB retains its typed infrastructure settings.

Copy `.env.example` to `.env`. Never commit `.env` or print configuration objects. Production secrets must come from the deployment secret store.

| Variable               | Default                                  | Notes                                                           |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`             | `development`                            | `development`, `test`, `staging`, or `production`               |
| `SERVICE_NAME`         | `store-management-api`                   | Lowercase service identifier for logs                           |
| `PORT`                 | `3000`                                   | Integer from 1 through 65535                                    |
| `LOG_LEVEL`            | `debug` in development, otherwise `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` |
| `HTTP_LOGGING_ENABLED` | `true`                                   | Must be the literal `true` or `false`                           |
| `API_PREFIX`           | `api`                                    | Single lowercase path segment                                   |
| `API_DEFAULT_VERSION`  | `1`                                      | Positive numeric version segment                                |
| `MONGODB_URI`          | required                                 | Secret-store value in deployed environments                     |

Add new settings to the central validator and a named config section. Do not read `process.env` in controllers or services.

## Logging

Inject `PinoLogger` from `nestjs-pino`; avoid `console.log` and logging secrets or full request payloads.

```ts
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class ExampleService {
  constructor(private readonly logger: PinoLogger) {}

  recordCompleted(recordId: string): void {
    this.logger.info({ recordId }, 'Record completed');
  }
}
```

Production and test output is JSON with ISO timestamps, service/environment labels, request ID, correlation ID, level, context, and message. Development uses `pino-pretty`. HTTP logs omit query strings and bodies. Central redaction covers auth headers and common credential/PII field names at several object depths. Because key-path redaction cannot inspect arbitrary text inside a message, do not interpolate user input, credentials, or raw errors into messages. For new sensitive property names, extend the central redaction list and its tests.

The selected `nestjs-pino` release requires Node.js 22.12 or newer; `package.json` declares that runtime floor.

## Request and correlation IDs

`RequestContextMiddleware` accepts bounded `x-request-id` and `x-correlation-id` values containing only letters, digits, `.`, `_`, `:`, and `-`. It generates replacements for missing or invalid values, returns both headers, and places them in an `AsyncLocalStorage` context. `RequestContextService.current()` reads the current request context without threading IDs through every function call.

Request ID identifies one HTTP request; correlation ID identifies a logical operation and may be supplied by an upstream caller. Both are diagnostic identifiers, not credentials or authorization data. Future worker entry points should explicitly establish context from validated job metadata. Distributed tracing remains a separate concern.

## Error handling and HTTP error contract

All HTTP exceptions are converted by `ProblemDetailsFilter` to `application/problem+json`, based on RFC 9457. The body includes `type`, `title`, `status`, `detail`, `instance`, stable `code`, and `requestId`; validation errors may include a `field`, stable field `code`, and safe `message` list.

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "instance": "/api/v1/example",
  "code": "VALIDATION_ERROR",
  "requestId": "request-id",
  "errors": [
    {
      "field": "email",
      "code": "INVALID_FORMAT",
      "message": "The value has an invalid format."
    }
  ]
}
```

Expected HTTP/application errors retain their proper status. Recognized Mongoose validation and cast errors map to 400; duplicate-key errors map to 409; database network/selection errors map to 503. Unexpected errors return a generic 500 body and are logged server-side with stack context. Do not put raw driver messages, submitted values, or stack traces in client responses.

Future application/domain code may throw `ApplicationException` with a stable code, HTTP status, safe detail, and optional field errors. Keep domain-specific codes near the owning domain and do not duplicate the global filter.

## Success responses and pagination

Successful resource responses are returned directly; there is no universal `{ data: ... }` wrapper. Preserve HTTP status semantics: use 201 for created resources and 204 when there is intentionally no response body. Paginated collection endpoints use `PaginatedResponse<T>` with `data` and explicit `meta` fields (`page`, `pageSize`, `totalItems`, `totalPages`). Downloads and streaming responses retain their HTTP/file semantics.

## Validation and DTOs

The global `ValidationPipe` uses `class-validator` and `class-transformer`, rejects unknown properties, transforms DTO objects, and does not enable implicit conversion. Use concrete DTO classes and decorators for every accepted field. Nested DTOs need `@ValidateNested()` and `@Type(() => NestedDto)`; arrays need explicit element validation. Use `ParseIntPipe`, `ParseBoolPipe`, or a custom parse pipe for primitive route/query values. Avoid broad index signatures and mass-assigning DTOs to persistence models.

Validation failures are mapped to safe, stable field codes. The validation response excludes validator target objects and submitted values.

## Serialization and persistence models

Map persistence records into response DTO instances; never return raw Mongoose documents from controllers. Use `@Exclude()` on response DTO classes and `@Expose()` on fields that are part of the public API. The global `ClassSerializerInterceptor` removes unexposed properties. Serialize ObjectIds as strings in the mapper and represent dates consistently as ISO JSON dates. Keep database models and API response types separate.

## API prefix and version policy

Application endpoints use URI versioning: `/api/v1/...`. New controllers should declare an explicit version, normally `@Controller({ path: 'records', version: '1' })`. Introduce breaking changes at a new version and document a deprecation window; do not duplicate an entire module when route-level/controller-level versioning is sufficient.

Health routes stay version-neutral and outside the prefix: `GET /health/live` is process liveness; `GET /health/database` is database readiness. They return 200 when healthy and readiness returns 503 when MongoDB is unavailable. Nest supports version-neutral routes and global-prefix exclusions for this purpose.

## Testing and adding a module

Run `npm test`, `npm run test:e2e`, and `npm run test:integration`. The full application integration suite uses an isolated in-memory replica set and exercises the HTTP request lifecycle, not a developer's database.

For a new module:

1. Add its typed configuration through the core config validator if needed.
2. Declare a versioned controller and explicit input DTOs.
3. Map persistence results into `@Exclude()` response DTOs.
4. Use `RequestContextService` only when an application operation needs request metadata.
5. Log structured event fields through `PinoLogger`; never log request bodies or secrets.
6. Throw `ApplicationException` for safe, expected application failures.
7. Add tests for status codes, request IDs, validation, serialization, and error codes.
