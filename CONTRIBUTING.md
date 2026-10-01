# Contributing

## Development checks

```sh
npm ci
npm run lint:ci
npm run ts-check
npm run test:coverage
npm run test:package
npm run docs
```

Keep statements, branches, functions, and lines at 100% for every runtime file and for the project aggregate.
Each test should assert an observable result or a meaningful storage interaction. Do not lower thresholds, exclude
runtime branches, or add execution-only tests to satisfy coverage. Check type-only modules through compile-only fixtures.

Use fake IndexedDB for transaction and persistence tests. Use deferred promises to control request and storage races.
Package checks unpack an npm archive, compile ESM/CJS consumers against its declarations, and exercise both entrypoints
without browser storage. Build before running `scripts/check-package.mjs` directly.

## Public API and dependencies

Keep generic cache factories and shared cache types in the root entrypoint. Keep OOMOL response types and their
environment-and-locale-keyed factories in `/oomol`, and maintain them when the API response contract changes. Preserve complete
successful envelopes, including Providers metadata, AppCatalog summary, category and authentication aggregates, sprite
metadata, and complete service Action catalogs.

Keep OOMOL factory namespaces stable and include deployment environment and locale in their cache identity. Add a new
factory only when an endpoint has its own response contract. Providers, Actions and App Catalog responses are shared
catalog data, so their cache identity must not include account, team, flow, permission, or token values. A request may
require authentication for Providers or Actions; keep that concern in those factories' `load` functions. App Catalog
is public and does not require credentials. Do not make callers assemble OOMOL namespaces or locale keys. The optional
`environment` defaults to `production` and is reserved for deployment boundaries such as `staging`.
`get*Cache` uses a registry on `globalThis` under
`Symbol.for("oomol-lab.resource-cache.oomol-singletons")`, keyed by resource, environment, locale, and schema
version. An Actions cache uses `service` as its per-operation key, so one instance can serve multiple service catalogs.
A successful `dispose()` removes that registry entry while leaving the old reference closed. Keep the OOMOL surface to
the shared `get*Cache` functions; use the generic cache API when a different endpoint genuinely returns account- or
permission-specific data.

The factories accept host-provided request and decoding functions. Keep framework, HTTP client, and backend runtime
dependencies out of the package. Storage adapters and serializers are private implementation details; the current
public API has no custom adapter or serialization hook. Preserve the existing IndexedDB and sessionStorage backends.

Do not include private repository names, source paths, or commit identifiers in source comments, documentation,
type declarations, or package artifacts.

## Identity and data

- Encode `(namespace, schemaVersion, key)` without ambiguity; session identity also includes `sessionId`.
- Preserve exact namespace and session strings after checking that they are nonblank. Empty generated keys are valid.
- Capture configuration at construction. Reject invalid factory options synchronously with `TypeError`; reject operations
  when the key function throws or returns a nonstring.
- Decode stored bodies outside storage transactions. A decoder failure is a storage miss; retain usable in-memory data.
- Save complete responses. Do not merge business entities or infer server-side ordering from network completion order.
- Preserve caller-owned data references. Do not add deep cloning or freezing as part of an unrelated change.

## Freshness and validators

Use a valid timestamp and an independent invalidation marker:

```ts
fresh = !invalidated && validatedAt <= now && now - validatedAt < maxAge
```

`validatedAt` is Unix milliseconds at successful load or validation completion. Normalize missing, nonnumeric,
nonfinite, or negative stored times to zero with stale state. Future times are stale until the clock catches up.
Explicit invalidation preserves the historical time and remains stale at epoch zero.

A modified result replaces the complete body and ETag. An unmodified result confirms the body used for that request.
Undefined ETag preserves the old value; null clears it. Without a cached body, an unmodified result is a protocol error.
Failed loading preserves existing data and does not extend freshness or resolve with stale data.
Apply `maxAge` from configuration; do not derive it from HTTP Cache-Control.

## Storage transactions

`src/cache.ts` owns freshness, memory, request scheduling, and lifetime barriers. The storage backends own record layout
and atomic operations. Fix behavior in its owning implementation rather than adding compensating logic elsewhere.

For IndexedDB, keep metadata and bodies in separate records linked by a random response version. Complete reads,
writes, deletes, and scoped clears must be atomic. While memory is fresh, avoid storage reads. When memory is stale,
check metadata and read the body only if its version differs. Update validators after an unmodified result only if
the stored version still matches; leave missing or replaced responses untouched. Return whether the write committed
so skipped conditional updates cannot release a failed-cleanup barrier.

For sessionStorage, keep the complete record under one key. Metadata-only updates must retain the original JSON body,
even when decoding restores a different runtime shape.

Keep database and session keys in the package's own scope. `clear()` removes the configured namespace/schemaVersion/sessionId;
session `dispose()` removes all schema versions for the configured namespace/sessionId. Persistent disposal keeps data.
Old persistent schema versions remain until explicitly cleared through an instance configured for that version.

## Requests and lifetime barriers

- Share ordinary same-key loading within an instance. Different keys may load concurrently; instances do not share requests.
- If force arrives before loading starts, upgrade the pending round. If it arrives during loading, schedule a later round.
  Forces may share a round only when they arrive before it starts. An earlier failure must not discard queued validation.
- Caller cancellation rejects only that wait, including when it is the last waiter. Already aborted callers start no work.
  Remove signal listeners when waiting settles and handle late host promise rejections.
- Invalidate affected lifetimes immediately on `invalidate/remove/clear/dispose`. Older get/peek calls reject with `AbortError`;
  their continuations cannot repopulate memory or submit new writes, even if the host ignores cancellation.
- Publish replacement lifetimes and queue cleanup before notifying host abort listeners. These listeners may synchronously
  start new operations; cancel only the retired lifetimes. Set the shared disposal promise before emitting cancellation.
- Serialize this instance's storage operations. Cleanup follows writes already submitted and prevents older queued writes
  from submitting afterward. Keep network waits outside the storage queue and transaction callbacks.
- Preserve barriers after failed cleanup. Later `invalidate()` calls and skipped conditional writes cannot expose shielded records.
  Successful cleanup releases its own barrier without releasing a newer failed cleanup's barrier.
- After a save failure, retain the successful in-memory version through expiry and invalidation. Older stored data must not
  replace it. Release the barrier when that version is successfully persisted or the affected data is successfully removed.
- Close immediately on disposal. Repeated disposal is idempotent after success and retries failed session cleanup.
  All other methods reject after closing. Disposal must not wait for a host load that ignores cancellation.

These guarantees apply to the current instance. Keep cross-instance invalidation and logout coordination with the host;
do not add locks, broadcasts, eviction, or background refresh without a corresponding API and contract review.

## Documentation

Keep README examples and explanations focused on installation, calls, returned values, and integration decisions.
Keep implementation invariants and maintenance checks here. State behavior directly; omit implementation history,
production notes, repeated capability announcements, and private provenance.
