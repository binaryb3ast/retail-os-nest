# User Management — Phase 0 Prerequisites

Status: prerequisite review for the approved User Management architecture. This note records verified repository facts, recommended integration contracts, and launch gates. It does not implement user, authentication, or authorization features.

## Repository facts

- There is no Branch model, module, service, or deployment definition for Branch data.
- `DatabaseTransactionService` is available. The database guide and `.env.example` state that multi-document transactions require a replica set; the example URI uses `replicaSet=rs0`.
- Production turns Mongoose `autoIndex` off. Domain indexes therefore need an explicit deployment/startup provisioning strategy.
- The repository has no email/SMS delivery provider, authentication module, general audit service, ingress configuration, or production deployment manifest.
- Request context provides request and correlation IDs. It does not provide an authenticated actor.

References: [MongoDB infrastructure guide](database/README.md), [Core infrastructure guide](core-infrastructure.md), and [.env.example](../.env.example).

## Branch integration contract

Membership and branch-scoped authorization must use an exported Branch service contract. They must not issue queries against a guessed `branches` collection or depend on Branch persistence models.

Recommended contract:

```ts
export interface BranchDirectory {
  findActiveById(
    branchId: Types.ObjectId,
  ): Promise<{ readonly id: Types.ObjectId } | null>;
}
```

The Branch module owns collection naming, schema, ObjectId conversion, and active/deactivated state. A missing or inactive branch returns `null`. Membership creation and every branch authorization decision call this contract. Branch deletion/deactivation must preserve historical references and prevent new branch operations. Whether deactivation also suspends memberships is a business decision; authorization must deny access while the Branch itself is inactive regardless.

The first concrete provider cannot be wired until a Branch module exists. Phase 1 may proceed with user and identity records, but branch memberships and branch-scoped roles remain gated on that provider.

## Administrator bootstrap

Recommended mechanism: a one-shot, operator-invoked command or deployment job that runs inside the application context. It is not an HTTP endpoint and is not enabled as part of normal application startup.

The operation should:

1. Require an explicit operator invocation and fail if a privileged active account already exists, unless a separately reviewed recovery operation is used.
2. Seed protected system roles idempotently from code before assigning one.
3. Create the first administrator, identity, password credential, role assignment, and audit event in one transaction.
4. Accept initial credentials through a secret input channel that does not echo or write them to logs. Hash the password before persistence; never emit a generated password to CI logs.
5. Record a bootstrap actor marker and request/operation ID in the audit event.

This keeps the initial trust path out of public routes. The exact operator command, secret-delivery method, and recovery approval process must be selected with the deployment owner before authentication routes are enabled.

## Identity verification and recovery delivery

No delivery provider is present. Email verification, invitations, and password recovery cannot safely be completed until a delivery channel is selected and configured.

Recommended V1 boundary:

- Do not expose public registration or password recovery yet.
- Permit only operator-provisioned `INVITED` users until a verified activation channel exists.
- Do not allow an unverified email identity to authenticate as an email identity.
- When delivery is added, store only a hash and expiry for the one-time verification/reset token; never log or audit the token.
- Keep phone OTP, email OTP, and magic links out of V1.

Owner decision needed: select the email delivery provider and define sender/domain configuration, delivery failure behavior, and account recovery support. The application should not treat an admin-provided email as verified by default, except for the first bootstrap administrator through the controlled operator procedure.

## Audit retention and privacy

The settings audit collection is specific to settings; there is no general audit service. User/security audit events should be stored in a dedicated append-only collection, with no TTL cleanup until a retention policy is approved.

Owner decision needed: choose retention duration, jurisdictional requirements, access roles, and how actor snapshots are handled if profile data is anonymized. Do not implement a guessed retention period or delete audit data automatically before that policy exists.

Audit events must exclude passwords, password hashes, raw reset/verification tokens, OTP values, and session tokens. Include actor and target IDs, action, scope, branch ID when applicable, request/correlation IDs, timestamp, and reason where supplied.

## MongoDB and indexes

The repository documentation confirms that multi-document transactions need a replica set or sharded cluster. Production topology is not represented in this repository, so deployment must be verified before enabling flows that atomically write user, identity, credential, membership/assignment, and audit records.

Because production sets `autoIndex: false`, unique identity, membership, role, assignment, and session indexes must be provisioned deliberately before traffic is enabled. Index creation must fail deployment/startup if duplicates exist; do not silently continue without the uniqueness constraints. Index builds should be treated as a deployment operation once real account data exists.

Owner/deployment decision needed: confirm production MongoDB topology, index rollout owner, backup/restore procedure, and whether all target environments support transactions.

## Rate limiting and launch boundary

There is no ingress or rate-limit configuration in the repository. Before password login is exposed, deployment must provide rate limiting that is effective across all application instances. Per-account failed-attempt tracking is a second control, not a replacement for shared IP/edge throttling.

The login response must not reveal whether an identity exists, whether a password is wrong, or whether an account is suspended. The same rule applies to recovery requests. Do not mount user administration routes before the bootstrap path, session guard, permission guard, and initial privileged role are ready.

Owner/deployment decision needed: identify the gateway/ingress owner and confirm rate-limit policy for login, identity verification, and password recovery.

## Phase 0 readiness checklist

| Gate | Current assessment | Required before |
|---|---|---|
| Branch service contract | Specified above; provider absent | Membership implementation |
| Bootstrap path | Recommended offline command/job; operational details unselected | First protected admin route |
| Identity delivery | No provider; public activation/recovery deferred | Invite/verification/reset flows |
| Audit retention | No policy; automatic cleanup deferred | Production audit rollout |
| Production replica set | Required by code/docs; production topology unverified | Multi-document writes |
| Index provisioning | `autoIndex` disabled in production; deployment process absent | User/identity data traffic |
| Shared rate limiting | No ingress config found | Public login/recovery |

Once the deployment and product owners confirm the items marked as decisions, Phase 1 can implement user and identity records. The Branch provider and delivery channel remain separate dependencies for membership and activation flows.
