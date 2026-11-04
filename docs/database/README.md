# MongoDB infrastructure

## Architecture

`DatabaseModule` owns the application's single shared Mongoose connection, connection lifecycle logging, the database readiness endpoint, and a small transaction helper. It is imported once by `AppModule`. Feature modules should inject models registered with `MongooseModule.forFeature()` and must not call `forRoot()` or create their own connections.

The project uses NestJS 11 and a shared core configuration/logging layer. Database lifecycle events use Nest's `Logger`, which bootstrap routes through the Pino logger so database and request logs share the structured format. Nest Config validates environment variables at startup. Mongoose's connection pool owns sockets and bounds concurrent connections. See the [core infrastructure guide](../core-infrastructure.md) for logging, request context, errors, validation, and API versioning.

## Environment variables

Copy `.env.example` to `.env` for local development. `.env` is ignored by Git. Supply production values through the deployment secret/configuration store. `MONGODB_URI` is required; credentials belong only in that secret and are never written to logs. Numeric values are parsed and validated at startup; minimum pool size cannot exceed maximum pool size.

| Variable                              |            Default | Purpose                                               |
| ------------------------------------- | -----------------: | ----------------------------------------------------- |
| `MONGODB_URI`                         |           required | MongoDB URI; configure a replica set for transactions |
| `MONGODB_DB_NAME`                     | `store_management` | Database name                                         |
| `MONGODB_MAX_POOL_SIZE`               |               `20` | Per-process upper bound for pooled connections        |
| `MONGODB_MIN_POOL_SIZE`               |                `0` | Avoid idle sockets when demand is low                 |
| `MONGODB_MAX_CONNECTING`              |                `2` | Bound concurrent pool establishment                   |
| `MONGODB_MAX_IDLE_TIME_MS`            |            `60000` | Retire idle pooled connections                        |
| `MONGODB_WAIT_QUEUE_TIMEOUT_MS`       |            `10000` | Bound time waiting for a pool socket                  |
| `MONGODB_CONNECT_TIMEOUT_MS`          |            `10000` | Bound individual socket connection establishment      |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` |            `10000` | Bound server discovery and selection                  |
| `MONGODB_SOCKET_TIMEOUT_MS`           |            `45000` | Bound inactive socket operations                      |
| `MONGODB_RETRY_ATTEMPTS`              |                `5` | Bounded initial connection retries by Nest Mongoose   |
| `MONGODB_RETRY_DELAY_MS`              |             `3000` | Delay between initial connection retries              |

The pool defaults support a modest single application instance without holding idle connections open. `maxPoolSize` is per process and per server in a topology: size it against the MongoDB connection budget and the maximum number of app replicas. Do not increase it without load measurements. Driver pool limits are not request concurrency limits; `waitQueueTimeoutMS` bounds excess demand.

## Local setup and replica set

Transactions spanning multiple documents require a replica set (or a sharded cluster). A standalone MongoDB server does not support them. Use a local replica set for development, staging, and production whenever transaction functionality is used. For a local single-node setup, start `mongod` with `--replSet rs0`, connect with `mongosh`, and run `rs.initiate()`. The sample URI includes `replicaSet=rs0`. Confirm `rs.status()` reports a primary before starting the application.

`npm run start:dev` loads `.env`, validates configuration, then connects. Failed startup connections use bounded retries; operations after startup use normal driver selection and pool timeouts. Connection event logs contain only lifecycle state, never the URI or credentials.

## Schema and model conventions

- Schemas live inside their owning domain module; each module owns its models and indexes.
- Infrastructure never imports domain schemas, and models share the infrastructure connection through `forFeature()`.
- Prefer schema-level `strict: true`, `timestamps: true`, and an explicit version key strategy. Set these on each schema (or through an explicit shared schema factory when one is actually adopted), rather than changing Mongoose's process-wide mutable defaults.
- Treat `undefined` as absent input: omit undefined filters and use `$exists` when field presence is the intended query. Do not rely on ODM-specific undefined matching behavior for correctness.
- Use explicit collection names where they improve clarity or preserve an external contract.
- Add `ObjectId` references only for real relationships. Avoid broad population on high-volume paths.
- Define indexes from observed query patterns and validate their effect with query plans.
- Mongoose strict schema behavior and query behavior should be selected per schema. Do not globally force lean queries, suppress validation, or change undefined-field matching behavior.

## Transactions

Inject `DatabaseTransactionService` and pass all operations in one unit of work the supplied session:

```ts
return this.transactions.execute(async (session) => {
  const created = await this.model.create([{/* domain data */}], { session });
  await this.auditModel.create([{/* related record */}], { session });
  return created[0];
});
```

The helper creates one session, delegates retry/commit/abort semantics to the MongoDB driver's `withTransaction`, always ends the session, and rethrows failures. Do not call it recursively. The driver may re-run a transaction callback after transient errors, so callbacks must avoid non-idempotent external side effects (email, HTTP calls, message publishing); use an outbox or perform those effects after commit. Transactions do not make standalone MongoDB transactional.

## Health and shutdown

`GET /health/live` reports that the process can answer requests and does not query MongoDB. `GET /health/database` runs a lightweight `ping` and returns HTTP 200 only when the connection is ready; a disconnected or failing database returns HTTP 503 without exposing connection details. The second endpoint is readiness. The application enables Nest shutdown hooks so Mongoose can drain and close its shared connection during graceful termination.

## Index management

Automatic index creation is enabled outside production and disabled in production. Domain indexes belong next to their schemas and should be reviewed for write/storage cost and query-plan benefit. In production, introduce indexes through a controlled deployment step or reviewed migration, verify completion and effectiveness, and record the change in deployment history. Application startup never drops indexes or performs destructive index changes. This starter has no migration tool or domain indexes; add a dedicated tool only when an actual migration workflow is established.

## Testing

- `npm test -- --runInBand` runs configuration, health, and transaction unit tests.
- `npm run test:e2e` exercises the starter HTTP route without requiring MongoDB.
- `npm run test:integration` starts an isolated in-memory replica set for connection readiness, transaction, failure timeout, and shutdown checks. The first run may download the MongoDB test binary; no developer or production database is used.

## Common deployment issues

- **Server selection timeout:** check DNS, firewall rules, TLS requirements, URI host list, and replica set name.
- **Authentication failure:** check the secret, user roles, and percent encoding of special characters in URI credentials. Never paste the URI into logs or tickets.
- **Transactions unsupported:** the target is standalone or the replica set has not elected a primary; verify topology before enabling transaction-dependent features.
- **Pool wait queue timeout:** inspect request concurrency, slow operations, replica count, and MongoDB connection limits before changing pool sizes.
- **Startup retries exhausted:** verify that environment variables are injected correctly and the database is reachable from the application network.
