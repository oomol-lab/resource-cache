import { createPersistentCache } from "./index";
import type { CacheOptions, CacheValidation, LoadResult, ResourceCache } from "./types";

/** Namespaces reserved for the OOMOL response factories. */
export const oomolNamespaces = {
  providers: "oomol:providers",
  actions: "oomol:actions",
  appCatalog: "oomol:app-catalog",
} as const;

export interface OomolQuery {
  readonly locale: string;
}

export interface ActionsQuery extends OomolQuery {
  readonly service: string;
}

export interface OomolCacheOptions<T> {
  /** Optional non-secret identity for a data environment or user/team/permission scope. */
  readonly scope?: string;
  /** Locale sent to the host loader and included in the cache identity. */
  readonly locale: string;
  readonly schemaVersion: number;
  readonly maxAge: number;
  readonly decode: (value: unknown) => T;
  readonly load: (query: OomolQuery, validation: CacheValidation) => Promise<LoadResult<T>>;
}

export type ActionsCacheOptions = Omit<OomolCacheOptions<ActionsResponse>, "load"> & {
  readonly load: (query: ActionsQuery, validation: CacheValidation) => Promise<LoadResult<ActionsResponse>>;
};

export type OomolCache<T> = ResourceCache<T, void>;
export type ActionsCache = ResourceCache<ActionsResponse, string>;

type SingletonRegistry = Map<string, ResourceCache<unknown, unknown>>;

const singletonRegistrySymbol = Symbol.for("oomol-lab.resource-cache.oomol-singletons");
const singletonCaches =
  (Reflect.get(globalThis, singletonRegistrySymbol) as SingletonRegistry | undefined) ??
  (() => {
    const registry: SingletonRegistry = new Map();
    Reflect.set(globalThis, singletonRegistrySymbol, registry);
    return registry;
  })();

function createOomolCache<T>(resource: string, options: OomolCacheOptions<T>, query: OomolQuery): OomolCache<T> {
  const scope = validateOomolOptions(options);
  const { load } = options;
  const key = JSON.stringify(query);
  const cacheOptions: CacheOptions<T, void> = {
    namespace: JSON.stringify([resource, scope]),
    schemaVersion: options.schemaVersion,
    maxAge: options.maxAge,
    key: () => key,
    decode: options.decode,
    load: (_query, validation) => load({ ...query }, validation),
  };
  return createPersistentCache(cacheOptions);
}

function validateOomolOptions(options: {
  readonly scope?: unknown;
  readonly locale?: unknown;
  readonly load?: unknown;
}): string {
  const scope = options.scope === undefined ? "default" : options.scope;
  if (typeof scope !== "string" || !scope.trim()) throw new TypeError("scope must be nonempty");
  if (typeof options.locale !== "string" || !options.locale.trim()) throw new TypeError("locale must be nonempty");
  if (typeof options.load !== "function") throw new TypeError("load must be a function");
  return scope;
}

/** Create an IndexedDB cache for GET /v1/providers, scoped by environment, identity and locale. */
export function createProvidersCache(options: OomolCacheOptions<ProvidersResponse>): OomolCache<ProvidersResponse> {
  return createOomolCache(oomolNamespaces.providers, options, { locale: options.locale });
}

/** Create an IndexedDB cache for GET /v1/actions?service=…, keyed by the service passed to each operation. */
export function createActionsCache(options: ActionsCacheOptions): ActionsCache {
  const scope = validateOomolOptions(options);
  const { locale, load } = options;
  return createPersistentCache<ActionsResponse, string>({
    namespace: JSON.stringify([oomolNamespaces.actions, scope]),
    schemaVersion: options.schemaVersion,
    maxAge: options.maxAge,
    key: (service) => {
      if (typeof service !== "string" || !service.trim()) throw new TypeError("service must be nonempty");
      return JSON.stringify([locale, service]);
    },
    decode: options.decode,
    load: (service, validation) => load({ locale, service }, validation),
  });
}

/** Create an IndexedDB cache for GET /public/v1/apps, scoped by environment and locale. */
export function createAppCatalogCache(options: OomolCacheOptions<AppCatalogResponse>): OomolCache<AppCatalogResponse> {
  return createOomolCache(oomolNamespaces.appCatalog, options, { locale: options.locale });
}

function singletonKey(
  resource: string,
  options: Pick<OomolCacheOptions<unknown>, "scope" | "schemaVersion">,
  query: OomolQuery,
): string {
  const scope = options.scope === undefined ? "default" : options.scope;
  return JSON.stringify([resource, scope, options.schemaVersion, query]);
}

function getSingleton<T, Q>(key: string, create: () => ResourceCache<T, Q>): ResourceCache<T, Q> {
  const existing = singletonCaches.get(key);
  if (existing) return existing as ResourceCache<T, Q>;

  const cache = create();
  let disposal: Promise<void> | undefined;
  const singleton: ResourceCache<T, Q> = {
    ...cache,
    dispose() {
      if (!disposal) {
        disposal = cache.dispose().then(() => {
          singletonCaches.delete(key);
        });
      }
      return disposal;
    },
  };
  singletonCaches.set(key, singleton as ResourceCache<unknown, unknown>);
  return singleton;
}

/** Return the shared Providers cache for one scope, locale and schema version. */
export function getProvidersCache(options: OomolCacheOptions<ProvidersResponse>): OomolCache<ProvidersResponse> {
  const query = { locale: options.locale };
  return getSingleton(singletonKey(oomolNamespaces.providers, options, query), () =>
    createOomolCache(oomolNamespaces.providers, options, query),
  );
}

/** Return the shared Actions cache for one scope, locale and schema version. */
export function getActionsCache(options: ActionsCacheOptions): ActionsCache {
  const query = { locale: options.locale };
  return getSingleton(singletonKey(oomolNamespaces.actions, options, query), () => createActionsCache(options));
}

/** Return the shared App Catalog cache for one scope, locale and schema version. */
export function getAppCatalogCache(options: OomolCacheOptions<AppCatalogResponse>): OomolCache<AppCatalogResponse> {
  const query = { locale: options.locale };
  return getSingleton(singletonKey(oomolNamespaces.appCatalog, options, query), () =>
    createOomolCache(oomolNamespaces.appCatalog, options, query),
  );
}

export type CredentialAuthType = "oauth2" | "api_key" | "custom_credential" | "no_auth" | "federated";

export interface ProviderIconSprite {
  version: string;
  pixelRatio: number;
  iconSize: number;
  bleed: number;
  width: number;
  height: number;
  lightUrl: string;
  darkUrl: string;
}

export interface ProviderListItem {
  service: string;
  displayName: string;
  searchAliases: string[];
  iconUrl: string | null;
  homepageUrl: string | null;
  categories: { id: string; displayName: string }[];
  authTypes: CredentialAuthType[];
  iconSpritePosition: { x: number; y: number } | null;
}

/** Complete GET /v1/providers success response, including sprite metadata. */
export interface ProvidersResponse {
  success: true;
  message: string;
  data: ProviderListItem[];
  meta: { totalCount: number; iconSprite: ProviderIconSprite | null };
}

export type ActionAsyncLifecycle =
  | {
      role: "submit";
      resultAction: string;
      handle: { outputField: string; inputField: string };
    }
  | {
      role: "result";
      wait: {
        intervalSeconds: number;
        state: { field: string; running: string[]; success: string[]; failure: string[] };
        resultField?: string;
      };
    };

export interface ActionCatalogItem {
  id: string;
  service: string;
  name: string;
  description: string;
  operationType: "read" | "write" | "destructive";
  requiredScopes: string[];
  providerPermissions: string[];
  followUpActions?: {
    actionId: string;
    description?: string;
    recommended?: boolean;
    inputFromOutput?: Record<string, string>;
  }[];
  asyncLifecycle?: ActionAsyncLifecycle;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

/** Complete GET /v1/actions?service=… success response, excluding the service index. */
export interface ActionsResponse {
  success: true;
  message: string;
  data: ActionCatalogItem[];
}

export interface AppCatalogItem extends ProviderListItem {
  actionCount: number;
  featuredActions: { id: string; name: string; displayName: string }[];
  status: "available" | "degraded" | "incident" | "unknown";
  healthScore?: number | null;
  lastCheckedAt?: string;
}

export interface AppCatalogSummary {
  providerCount: number;
  actionCount: number;
  categoryCount: number;
  oauthProviderCount: number;
  apiKeyProviderCount: number;
  healthyProviderCount: number | null;
}

/** Complete GET /public/v1/apps success response, including catalog aggregates and sprite metadata. */
export interface AppCatalogResponse {
  success: true;
  message: string;
  data: AppCatalogItem[];
  meta: {
    summary: AppCatalogSummary;
    categories: { id: string; displayName: string; providerCount: number; actionCount: number }[];
    authTypes: { id: CredentialAuthType; displayName: string; providerCount: number }[];
    iconSprite: ProviderIconSprite | null;
  };
}
