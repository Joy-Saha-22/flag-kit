# FlagKit data model

This document describes the MongoDB collections, Redis keys, hashing rules, and evaluation contract used by the data layer. HTTP routes are out of scope for this slice.

Connection strings, JWT material, and SDK key plaintext never appear in logs. SDK keys are generated with `crypto.randomBytes`, returned once to the caller, and persisted only as SHA-256 hex plus a short display prefix.

## MongoDB collections

### `users`

| Field | Type | Notes |
| --- | --- | --- |
| email | string | unique, lowercased |
| passwordHash | string | bcrypt |
| name | string | |
| createdAt | Date | |

### `projects`

| Field | Type | Notes |
| --- | --- | --- |
| name | string | |
| key | string | unique, lowercased slug |
| members | `{ userId, role }[]` | `role` is `admin`, `editor`, or `viewer` |
| createdAt | Date | |

### `environments`

| Field | Type | Notes |
| --- | --- | --- |
| projectId | ObjectId | |
| key | string | e.g. `development`, `staging`, `production` |
| name | string | |
| sdkKeys | `{ keyHash, prefix, type, createdAt, revokedAt }[]` | `type` is `server` or `client`. `revokedAt` is set on revoke; plaintext is never stored |
| createdAt | Date | |

Indexes:

- unique `(projectId, key)`
- unique sparse `sdkKeys.keyHash`

### `flags`

| Field | Type | Notes |
| --- | --- | --- |
| projectId | ObjectId | |
| key | string | flag key, unique per project |
| name | string | |
| description | string | |
| tags | string[] | |
| variations | `{ key, name, value }[]` | `value` may be bool, number, string, or JSON |
| isExperiment | bool | when true, SDKs emit exposure events |
| goalMetricKey | string \| null | conversion metric for experiments |
| environments | Map envKey → config | see below |
| createdAt, updatedAt | Date | |

Index: unique `(projectId, key)`.

Per-environment config:

```
{
  enabled: boolean,
  offVariation: string,          // variation key
  fallthrough: Serve,
  rules: TargetingRule[],        // ordered; first match wins
  version: number                // increment on each config write
}

Serve =
  { variation: string }
  | { rollout: [{ variation: string, weight: number }] }

TargetingRule = {
  id: string,
  conditions: [{
    attribute: string,
    operator: "equals" | "notEquals" | "in" | "contains" | "startsWith" | "gt" | "lt",
    values: unknown[]
  }],
  serve: Serve
}
```

Rollout weights are integers that **sum to 100000** (basis points of a percent, mapped onto buckets `0..99999`).

### `events`

SDK batch payload persisted for experiment results.

| Field | Type | Notes |
| --- | --- | --- |
| projectId | ObjectId | |
| envKey | string | |
| type | `exposure` \| `conversion` | |
| flagKey | string | |
| variation | string | variation the user was served |
| userKey | string | |
| metricKey | string \| null | required for conversions |
| ts | Date | |

Indexes:

- `(envKey, flagKey, type, variation)` for result aggregation
- `(ts)` TTL of **30 days** (`expireAfterSeconds: 2592000`)
- `(projectId, envKey, flagKey)` for project-scoped queries

### `auditLogs`

| Field | Type | Notes |
| --- | --- | --- |
| projectId | ObjectId | |
| actorId | ObjectId | dashboard user |
| action | string | e.g. `flag.update`, `sdkKey.revoke` |
| flagKey | string \| null | |
| envKey | string \| null | |
| before | Mixed \| null | |
| after | Mixed \| null | |
| ts | Date | |

Index: `(projectId, ts desc)`.

## Redis

TCP via ioredis. Three connections: **cache** (GET/SET), **publisher**, **subscriber**. A subscribed connection cannot run ordinary commands, so pub/sub is split.

| Key / channel | Value | TTL |
| --- | --- | --- |
| `ruleset:{envId}` | JSON `{ version, flags }` — full ruleset for that environment (`envId` is the Environment document `_id`) | none (replaced on write) |
| `sdkkey:{keyHash}` | JSON `{ envId, projectId, envKey, type }` | **60 seconds** |
| pub/sub `flag-updates:{envId}` | JSON payload describing the change | n/a |

`{keyHash}` is hex SHA-256 of the plaintext SDK key. Cache hits avoid a MongoDB lookup on every SDK request; after TTL expiry the API re-reads Environment.sdkKeys (ignoring revoked keys) and repopulates Redis.

### Ruleset JSON shape

```
{
  "version": 42,
  "flags": [
    {
      "key": "homepage-hero",
      "variations": [{ "key": "control", "value": "original" }, ...],
      "isExperiment": true,
      "goalMetricKey": "signup_completed",
      "enabled": true,
      "offVariation": "control",
      "fallthrough": { "rollout": [{ "variation": "control", "weight": 33334 }, ...] },
      "rules": [...],
      "version": 3
    }
  ]
}
```

`version` at the top level is a monotonic environment ruleset version (max of flag env versions, or a dedicated counter). SSE sends `put` with this document on connect and `patch` with a single flag object on change.

## Evaluation (for later evaluator / SDK)

Order:

1. If the flag config is missing → treat as off / not found (API layer).
2. If `enabled === false` → `offVariation`. Reason: `off`.
3. Else walk `rules` in order. First rule whose **all** conditions match the user context wins; serve that rule's `Serve`.
4. Else serve `fallthrough`.

`Serve`:

- `{ variation }` → that variation key.
- `{ rollout }` → deterministic bucket (below).

### Percentage rollout

```
bucket = hash32(flagKey + ":" + salt + ":" + userKey) mapped to 0..99999
```

Walk rollout entries accumulating `weight`. The first entry whose cumulative weight is greater than `bucket` is selected. The same `(flagKey, salt, userKey)` always maps to the same variation.

**Salt:** this slice does not persist a separate salt field. Use the environment key as `salt` so buckets are stable per environment. Do not include secrets in the hash input.

A suitable 32-bit hash is well-distributed (e.g. murmur3 or sha256 truncated to 32 bits). Implementation lives in `packages/evaluator` (not in this slice).

## Experiments

A flag with `isExperiment: true` and `goalMetricKey` is an experiment. SDKs send:

- `exposure` — user was assigned / shown a variation
- `conversion` — user hit `goalMetricKey` (`metricKey` on the event)

Results (future API) aggregate per variation:

- exposures, conversions
- conversion rate = conversions / exposures
- two-proportion z-test p-value vs the **first variation** (control)

## SDK keys

- `server` keys are secrets for backend SDKs; they may fetch full rulesets and post events.
- `client` keys are public by design (browser); they may only read flags and send events.

Prefix (first 16 characters of the plaintext) is stored so the dashboard can show `fk_server_AbCd…` without keeping the secret.

## Environment variables

Validated at process start with Zod (`server/src/env.js`). Missing or placeholder/weak values refuse startup. Seed additionally requires `SEED_USER_*` and **exits if `NODE_ENV=production`**.

Copy `.env.example` to `.env` (gitignored) before `docker compose up` and `npm run seed`. Compose interpolates `MONGO_*` and `REDIS_PASSWORD` from `.env`; it does not hardcode credentials.
