// Compile-only contract checks. This file is also compiled against the packed
// package's ESM and CJS declarations by scripts/check-package.mjs.
import {
  type CacheSnapshot,
  createPersistentCache,
  createSessionCache,
  type LoadResult,
  type ResourceCache,
} from "../src/index";
import type { ActionsResponse, AppCatalogItem, AppCatalogResponse, ProvidersResponse } from "../src/oomol";

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

export type CatalogStatus = Assert<Equal<AppCatalogItem["status"], "available" | "degraded" | "incident" | "unknown">>;
export type CatalogHealth = Assert<Equal<AppCatalogItem["healthScore"], number | null | undefined>>;
export type CatalogCheckTime = Assert<Equal<AppCatalogItem["lastCheckedAt"], string | undefined>>;

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
