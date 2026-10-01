// Compile-only contract checks. This file is also compiled against the packed
// package's ESM and CJS declarations by scripts/check-package.mjs.
import {
  type CacheSnapshot,
  createPersistentCache,
  createSessionCache,
  type LoadResult,
  type ResourceCache,
} from "../src/index";
import {
  type ActionsCache,
  type ActionsCacheOptions,
  type ActionsResponse,
  type AppCatalogCacheOptions,
  type AppCatalogItem,
  type AppCatalogResponse,
  type ConnectionsCache,
  type ConnectionsCacheOptions,
  type ConnectionsResponse,
  getActionsCache,
  getAppCatalogCache,
  getConnectionsCache,
  getProvidersCache,
  type ProvidersCacheOptions,
  type ProvidersResponse,
} from "../src/oomol";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export const providers = {
  success: true,
  message: "OK",
  data: [
    {
      service: "example",
      displayName: "Example",
      searchAliases: ["example"],
      iconUrl: null,
      homepageUrl: null,
      categories: [{ id: "tools", displayName: "Tools" }],
      authTypes: ["federated", "no_auth"],
      iconSpritePosition: { x: 0, y: 0 },
    },
  ],
  meta: {
    totalCount: 1,
    iconSprite: {
      version: "v1",
      pixelRatio: 2,
      iconSize: 48,
      bleed: 1,
      width: 100,
      height: 100,
      lightUrl: "https://example.com/light.png",
      darkUrl: "https://example.com/dark.png",
    },
  },
} satisfies ProvidersResponse;

export const actions = {
  success: true,
  message: "OK",
  data: [
    {
      id: "example.read",
      service: "example",
      name: "read",
      description: "Read data",
      operationType: "read",
      requiredScopes: ["read"],
      providerPermissions: ["reader"],
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: { type: "object" },
      followUpActions: [
        {
          actionId: "example.result",
          description: "Wait for result",
          recommended: true,
          inputFromOutput: { task: "id" },
        },
      ],
      asyncLifecycle: { role: "submit", resultAction: "result", handle: { outputField: "id", inputField: "task" } },
    },
    {
      id: "example.result",
      service: "example",
      name: "result",
      description: "Get result",
      operationType: "write",
      requiredScopes: [],
      providerPermissions: [],
      inputSchema: {},
      outputSchema: {},
      asyncLifecycle: {
        role: "result",
        wait: {
          intervalSeconds: 1,
          state: { field: "status", running: ["pending"], success: ["done"], failure: ["error"] },
          resultField: "result",
        },
      },
    },
  ],
} satisfies ActionsResponse;

export const appCatalog = {
  success: true,
  message: "OK",
  data: [
    {
      ...providers.data[0],
      actionCount: 1,
      featuredActions: [{ id: "example.read", name: "read", displayName: "Read" }],
      status: "available",
      healthScore: null,
      lastCheckedAt: "2026-09-30T12:00:00Z",
    },
  ],
  meta: {
    summary: {
      providerCount: 1,
      actionCount: 1,
      categoryCount: 1,
      oauthProviderCount: 0,
      apiKeyProviderCount: 0,
      healthyProviderCount: null,
    },
    categories: [{ id: "tools", displayName: "Tools", providerCount: 1, actionCount: 1 }],
    authTypes: [
      { id: "federated", displayName: "Federated", providerCount: 1 },
      { id: "no_auth", displayName: "No authentication", providerCount: 1 },
    ],
    iconSprite: providers.meta.iconSprite,
  },
} satisfies AppCatalogResponse;

export const minimalAppCatalog = {
  success: true,
  message: "OK",
  data: [{ ...providers.data[0], iconSpritePosition: null, actionCount: 0, featuredActions: [], status: "unknown" }],
  meta: {
    summary: { ...appCatalog.meta.summary, actionCount: 0, healthyProviderCount: 0 },
    categories: [{ ...appCatalog.meta.categories[0], actionCount: 0 }],
    authTypes: appCatalog.meta.authTypes,
    iconSprite: null,
  },
} satisfies AppCatalogResponse;

export const connections = {
  success: true,
  message: "OK",
  data: [
    {
      id: "example-connection",
      service: "example",
      providerAccountId: "account-1",
      accountLabel: "Example",
      alias: null,
      aliasNormalized: null,
      comment: null,
      scopes: ["read"],
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      userId: "user-1",
      createdByUserId: "user-1",
      ownerType: "team",
      ownerTeamId: "team-1",
      authType: "oauth2",
      displayName: "Example",
      isDefault: true,
    },
  ],
  meta: {
    summary: {
      providerCount: 1,
      connectableProviderCount: 1,
      connectedProviderCount: 1,
      activeConnectedProviderCount: 1,
      connectedAppCount: 1,
      activeConnectedAppCount: 1,
      filteredAppCount: 1,
    },
  },
} satisfies ConnectionsResponse;

export type CatalogStatus = Assert<Equal<AppCatalogItem["status"], "available" | "degraded" | "incident" | "unknown">>;
export type CatalogHealth = Assert<Equal<AppCatalogItem["healthScore"], number | null | undefined>>;
export type CatalogCheckTime = Assert<Equal<AppCatalogItem["lastCheckedAt"], string | undefined>>;

const providerOptions: ProvidersCacheOptions = {
  locale: "en-US",
  schemaVersion: 1,
  maxAge: 0,
  decode: (value) => value as ProvidersResponse,
  load: async (_query, _validation) => ({ modified: true, data: providers, etag: null }),
};
export const providerCache = getProvidersCache(providerOptions);
export const sharedProviderCache = getProvidersCache(providerOptions);
const actionOptions: ActionsCacheOptions = {
  environment: "production",
  locale: "en-US",
  schemaVersion: 1,
  maxAge: 0,
  decode: (value) => value as ActionsResponse,
  load: async ({ service }) => ({ modified: true, data: { ...actions, message: service }, etag: null }),
};
export const actionCache = getActionsCache(actionOptions);
export const sharedActionCache = getActionsCache(actionOptions);
const appCatalogOptions: AppCatalogCacheOptions = {
  environment: "production",
  locale: "en-US",
  schemaVersion: 1,
  maxAge: 0,
  decode: (value) => value as AppCatalogResponse,
  load: async () => ({ modified: true, data: appCatalog, etag: null }),
};
export const appCatalogCache = getAppCatalogCache(appCatalogOptions);
export const sharedAppCatalogCache = getAppCatalogCache(appCatalogOptions);
const connectionsOptions: ConnectionsCacheOptions = {
  environment: "production",
  sessionId: "session-1",
  teamName: "team-1",
  schemaVersion: 1,
  maxAge: 0,
  decode: (value) => value as ConnectionsResponse,
  load: async ({ teamName }, { etag, signal }) =>
    signal.aborted
      ? { modified: false, etag }
      : { modified: true, data: { ...connections, message: teamName ?? "personal" }, etag: null },
};
export const connectionsCache = getConnectionsCache(connectionsOptions);
export const sharedConnectionsCache = getConnectionsCache(connectionsOptions);
export type ProviderCacheReturn = Assert<Equal<ReturnType<typeof providerCache.get>, Promise<ProvidersResponse>>>;
export type ActionCacheReturn = Assert<
  Equal<ReturnType<typeof actionCache.peek>, Promise<undefined | CacheSnapshot<ActionsResponse>>>
>;
export type ActionCacheShape = Assert<Equal<typeof actionCache, ActionsCache>>;
export const actionData = actionCache.get("example");
export type ActionGetReturn = Assert<Equal<typeof actionData, Promise<ActionsResponse>>>;
export type ConnectionsCacheShape = Assert<Equal<typeof connectionsCache, ConnectionsCache>>;
export type ConnectionsGetReturn = Assert<Equal<ReturnType<typeof connectionsCache.get>, Promise<ConnectionsResponse>>>;

export const cache = createPersistentCache({
  namespace: "types",
  schemaVersion: 1,
  maxAge: 0,
  key: (query: { locale: string }) => query.locale,
  decode: (value: unknown): ProvidersResponse => value as ProvidersResponse,
  load: async (_query, { etag, signal }): Promise<LoadResult<ProvidersResponse>> => {
    const validator: string | null = etag;
    const cancellation: AbortSignal = signal;
    return cancellation.aborted
      ? { modified: false, etag: validator }
      : { modified: true, data: providers, etag: null };
  },
});

export type InferredCache = Assert<Equal<typeof cache, ResourceCache<ProvidersResponse, { locale: string }>>>;
export type GetReturn = Assert<Equal<ReturnType<typeof cache.get>, Promise<ProvidersResponse>>>;
export type PeekReturn = Assert<
  Equal<ReturnType<typeof cache.peek>, Promise<CacheSnapshot<ProvidersResponse> | undefined>>
>;

declare const snapshot: CacheSnapshot<ProvidersResponse>;
// @ts-expect-error snapshots expose readonly metadata
snapshot.etag = null;
// @ts-expect-error queries retain their inferred shape
cache.get({ team: "wrong" });
// @ts-expect-error Actions service is the operation query
actionCache.get({ service: "example" });
// @ts-expect-error a modified response requires a complete body and validator
export const invalidLoad: LoadResult<ProvidersResponse> = { modified: true };
// @ts-expect-error sessionId is mandatory
createSessionCache({
  namespace: "test",
  schemaVersion: 1,
  maxAge: 0,
  key: () => "q",
  decode: () => "data",
  load: async () => ({ modified: false }),
});
// @ts-expect-error ProvidersResponse must retain its complete envelope metadata
export const withoutProviderMeta: ProvidersResponse = { success: true, message: "OK", data: [] };
// @ts-expect-error AppCatalogResponse must retain complete metadata
export const withoutAppCatalogMeta: AppCatalogResponse = { success: true, message: "OK", data: [] };
// @ts-expect-error the action service index is not a complete service action catalog
export const serviceIndex: ActionsResponse = { success: true, message: "OK", data: [{ service: "example" }] };

// @ts-expect-error catalog metadata requires categories, authTypes and iconSprite as well as summary
export const incompleteCatalogMeta: AppCatalogResponse["meta"] = { summary: appCatalog.meta.summary };
// @ts-expect-error catalog items require action counts and featured actions in addition to provider identity
export const incompleteCatalogItem: AppCatalogItem = providers.data[0];

// @ts-expect-error ConnectionsResponse must retain complete summary metadata
export const incompleteConnectionsMeta: ConnectionsResponse = { success: true, message: "OK", data: [] };
