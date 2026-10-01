# @oomol-lab/resource-cache

[![Docs](https://img.shields.io/badge/Docs-read-%23fdf9f5)](https://oomol-lab.github.io/resource-cache)
[![Build Status](https://github.com/oomol-lab/resource-cache/actions/workflows/build.yml/badge.svg)](https://github.com/oomol-lab/resource-cache/actions/workflows/build.yml)
[![npm-version](https://img.shields.io/npm/v/@oomol-lab/resource-cache.svg)](https://www.npmjs.com/package/@oomol-lab/resource-cache)
[![Coverage Status](https://oomol-lab.github.io/resource-cache/coverage-badges/@oomol-lab/resource-cache.svg)](https://oomol-lab.github.io/resource-cache/coverage/)
[![minified-size](https://deno.bundlejs.com/badge?q=@oomol-lab/resource-cache&treeshake=[*])](https://deno.bundlejs.com/?q=@oomol-lab/resource-cache&treeshake=[*])

Cache complete responses in IndexedDB or sessionStorage, with expiration and ETag revalidation.

## Install

```sh
npm add @oomol-lab/resource-cache
```

## Usage

```ts
import { createPersistentCache, type CacheOptions } from '@oomol-lab/resource-cache'

type Item = { id: string; name: string }
type Query = { locale: string }

function decodeItems(value: unknown): Item[] {
  if (!Array.isArray(value) || !value.every(item =>
    item !== null && typeof item === 'object' &&
    typeof item.id === 'string' && typeof item.name === 'string'
  )) {
    throw new TypeError('Invalid items response')
  }
  return value
}

const cacheOptions: CacheOptions<Item[], Query> = {
  namespace: 'production:items',
  schemaVersion: 1,
  maxAge: 5 * 60_000,
  key: ({ locale }) => locale,
  decode: decodeItems,
  async load({ locale }, { etag, signal }) {
    const response = await fetch(`/api/items?locale=${encodeURIComponent(locale)}`, {
      headers: etag === null ? {} : { 'If-None-Match': etag },
      signal,
    })
    if (response.status === 304) {
      return { modified: false, etag: response.headers.get('ETag') ?? undefined }
    }
    if (!response.ok) throw new Error(`Loading items failed: ${response.status}`)
    return {
      modified: true,
      data: decodeItems(await response.json()),
      etag: response.headers.get('ETag'),
    }
  },
}

const items = createPersistentCache(cacheOptions)
const data = await items.get({ locale: 'en' })
```

Use `load` to send requests and validate network responses. Use `decode` to restore stored data.
Treat returned data as read-only.

| `load` result | Meaning |
| --- | --- |
| `{ modified: true, data, etag }` | Replace the complete response and ETag. Use `null` when no ETag is available. |
| `{ modified: false, etag? }` | Reuse the response associated with the supplied ETag. Omit `etag` to retain it; use `null` to clear it. |

## Options

| Option | Value |
| --- | --- |
| `namespace` | Nonblank resource and environment name. |
| `schemaVersion` | Positive safe integer. Increment for incompatible response or decoding changes. |
| `maxAge` | Finite nonnegative milliseconds. Zero requires validation on every access. |
| `key(query)` | Stable string identifying the complete response. |
| `decode(value)` | Synchronous function that restores stored data; throw to reject an unusable record. |
| `load(query, { etag, signal })` | Async function returning a complete response or an unmodified result. |
| `sessionId` | Nonblank, non-secret login identifier, required by `createSessionCache`. |

Choose different namespaces for different data environments. Include locale, user, team, permissions, and filters
in the key when they affect the response. Caches sharing an identity must use compatible response and decoding contracts.
Invalid factory options throw `TypeError`.

IndexedDB data must support structured cloning. Session data must survive JSON serialization and restoration through `decode`.

## Read and refresh

| Call | Result |
| --- | --- |
| `get(query)` | Return fresh data or await loading. Loading errors reject the call. |
| `get(query, { revalidate: true })` | Require a new validation, even when cached data is fresh. |
| `get(query, { signal })` | Cancel this caller's wait with `AbortError`; shared loading continues. |
| `peek(query)` | Read without loading. Return a snapshot, possibly stale, or `undefined`. |

`maxAge` controls how long a successful response or validation can be reused. An unmodified result retains the cached
data and refreshes its validation time.
Returning `modified: false` without cached data rejects as a protocol error.

Concurrent loading of the same key is shared within an instance. A forced call made during an active request waits
for a subsequent validation. For stale UI display, read with `peek`, then request fresh data with `get`.

Failed storage reads fall back to loading. Successful loads remain available in memory when saving fails.

## Invalidate and clear

| Call | Effect |
| --- | --- |
| `invalidate(query)` | Mark stale while retaining data and ETag. |
| `remove(query)` | Delete data and ETag. |
| `clear()` | Clear the current namespace, schemaVersion, and sessionId scope. |
| `dispose()` | Close the instance. Keep IndexedDB data; delete session data for this namespace/sessionId across all schema versions. |

These calls reject affected in-flight `get` and `peek` calls with `AbortError`. Cleanup errors propagate to the caller;
failed deletion may leave stored data behind. Retry `dispose()` if session cleanup fails. Other methods reject after disposal.

Coordinate invalidation and logout across every affected instance and page. Other instances can retain fresh memory
or save their own request results after a cleanup.

## Login sessions

```ts
import { createSessionCache } from '@oomol-lab/resource-cache'

const sessionItems = createSessionCache({ ...cacheOptions, sessionId: loginSessionId })

// On logout:
await sessionItems.dispose()
```

Supply `loginSessionId` from the application's login state. Keep it stable across page refreshes within a login and
choose a new identifier for each new login. Never use an access token. Change the cache scope or invalidate related
caches when team or permission scope changes.

## OOMOL response types

```ts
import type {
  ProvidersResponse,
  ActionsResponse,
  AppCatalogResponse,
  ConnectionsResponse,
} from '@oomol-lab/resource-cache/oomol'
```

| Type | Successful response |
| --- | --- |
| `ProvidersResponse` | `/v1/providers`, including top-level `meta` and sprite metadata. |
| `ActionsResponse` | `/v1/actions?service=…`, including the complete service action catalog. |
| `AppCatalogResponse` | `/public/v1/apps`, including featured actions, availability, catalog aggregates, and sprite metadata. |
| `ConnectionsResponse` | `/v1/connections`, including connection app views and summary metadata. |

Validate these responses in `load` and `decode`.

The OOMOL entry exports separate configuration types, `ProvidersCacheOptions`, `ActionsCacheOptions`, and
`AppCatalogCacheOptions`, for the three catalog factories. These factories serve catalog data shared across accounts,
teams and flows. They use fixed namespaces and include `environment` and `locale` (and, for Actions, `service`) in the
cache identity, so callers do not need to construct namespace or key strings. `environment` defaults to `production`
and can be set to values such as `staging` when the host serves a separate deployment. A request may still require an
access token. Keep that token in the Providers or Actions request layer inside `load`; App Catalog is public and does
not require credentials. Credentials must not be used as a cache key, namespace, or environment value.

Use `getProvidersCache`, `getActionsCache`, and `getAppCatalogCache`. They return the shared cache for an environment,
locale and schema version. The first call fixes `load`, `decode`, and `maxAge` for that identity; provide a stable
`load` function that reads the current request credentials. The singleton registry is shared across package copies in
the same JavaScript runtime.

```ts
import { getAppCatalogCache } from '@oomol-lab/resource-cache/oomol'

const apps = getAppCatalogCache({
  environment: 'production',
  locale: 'zh-CN',
  schemaVersion: 1,
  maxAge: 10 * 60_000,
  decode: decodeAppCatalog,
  load: ({ locale }, validation) => api.getPublicApps({ locale, ...validation }),
})

const response = await apps.get()
```

An Actions cache accepts the service as the operation query, so one shared instance can serve multiple services:

```ts
import { getActionsCache } from '@oomol-lab/resource-cache/oomol'

const actions = getActionsCache({
  locale: 'zh-CN',
  schemaVersion: 1,
  maxAge: 10 * 60_000,
  decode: decodeActions,
  load: ({ locale, service }, validation) => api.getActions({ locale, service, ...validation }),
})

const gmail = await actions.get('gmail')
const calendar = await actions.get('calendar')
```

Connections are scoped to a login session and use `sessionStorage`. The required `sessionId` must be a stable,
non-secret login identifier, never an access token. `teamName` is optional for the personal scope and is part of the
cache identity when provided. Call `dispose()` when the session ends; it removes all connection scopes for that login
session.

```ts
import { getConnectionsCache } from '@oomol-lab/resource-cache/oomol'

const connections = getConnectionsCache({
  environment: 'production',
  sessionId: loginSessionId,
  teamName: currentTeamName,
  schemaVersion: 1,
  maxAge: 60_000,
  decode: decodeConnections,
  load: ({ teamName }, validation) => api.getConnections({ teamName, ...validation }),
})

const response = await connections.get()
await connections.dispose() // on logout
```

Use the generic cache API for account- or permission-specific endpoints that do not match the Connections response
contract.

## Contributing

[Development checks and implementation contracts](https://github.com/oomol-lab/resource-cache/blob/main/CONTRIBUTING.md)
