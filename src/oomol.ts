import { createPersistentCache, createSessionCache } from "./index";
import type { CacheOptions, CacheValidation, LoadResult, ResourceCache } from "./types";

/** Namespaces reserved for the OOMOL response factories. */
export const oomolNamespaces = {
  providers: "oomol:providers",
  actions: "oomol:actions",
  appCatalog: "oomol:app-catalog",
  connections: "oomol:connections",
} as const;

export interface OomolQuery {
  readonly locale: string;
}

export interface ActionsQuery extends OomolQuery {
  readonly service: string;
}

export interface ConnectionsQuery {
  readonly teamName?: string;
}

interface OomolCacheBaseOptions<T> {
  /** Deployment environment used to separate hosts such as production and staging. Defaults to `production`. */
  readonly environment?: string;
  /** Locale sent to the host loader and included in the cache identity. */
  readonly locale: string;
  readonly schemaVersion: number;
  readonly maxAge: number;
  readonly decode: (value: unknown) => T;
}

export interface ProvidersCacheOptions extends OomolCacheBaseOptions<ProvidersResponse> {
  /** Load the provider catalog; use request credentials only when the host endpoint requires them. */
  readonly load: (query: OomolQuery, validation: CacheValidation) => Promise<LoadResult<ProvidersResponse>>;
}

export interface ActionsCacheOptions extends OomolCacheBaseOptions<ActionsResponse> {
  /** Load the action catalog; use request credentials only when the host endpoint requires them. */
  readonly load: (query: ActionsQuery, validation: CacheValidation) => Promise<LoadResult<ActionsResponse>>;
}

export interface AppCatalogCacheOptions extends OomolCacheBaseOptions<AppCatalogResponse> {
  /** Load the public app catalog. This request does not require credentials. */
  readonly load: (query: OomolQuery, validation: CacheValidation) => Promise<LoadResult<AppCatalogResponse>>;
}

export interface ConnectionsCacheOptions {
  /** Deployment environment used to separate hosts such as production and staging. Defaults to `production`. */
  readonly environment?: string;
  /** Nonempty, non-secret identifier for the current login session. */
  readonly sessionId: string;
  /** Team scope sent to the host loader. Omit it for the personal scope. */
  readonly teamName?: string;
  readonly schemaVersion: number;
  readonly maxAge: number;
  readonly decode: (value: unknown) => ConnectionsResponse;
  /** Load the connection list; request credentials belong in the host request layer. */
  readonly load: (query: ConnectionsQuery, validation: CacheValidation) => Promise<LoadResult<ConnectionsResponse>>;
}

type OomolFactoryOptions<T> = OomolCacheBaseOptions<T> & {
  readonly load: (query: OomolQuery, validation: CacheValidation) => Promise<LoadResult<T>>;
};

export type OomolCache<T> = ResourceCache<T, void>;
export type ActionsCache = ResourceCache<ActionsResponse, string>;
export type ConnectionsCache = ResourceCache<ConnectionsResponse, void>;

type SingletonRegistry = Map<string, ResourceCache<unknown, unknown>>;

const singletonRegistrySymbol = Symbol.for("oomol-lab.resource-cache.oomol-singletons");
const singletonCaches =
  (Reflect.get(globalThis, singletonRegistrySymbol) as SingletonRegistry | undefined) ??
  (() => {
    const registry: SingletonRegistry = new Map();
    Reflect.set(globalThis, singletonRegistrySymbol, registry);
    return registry;
  })();

function createOomolCache<T>(resource: string, options: OomolFactoryOptions<T>, query: OomolQuery): OomolCache<T> {
  const environment = validateOomolOptions(options);
  const { load } = options;
  const key = JSON.stringify(query);
  const cacheOptions: CacheOptions<T, void> = {
    namespace: JSON.stringify([resource, environment]),
    schemaVersion: options.schemaVersion,
    maxAge: options.maxAge,
    key: () => key,
    decode: options.decode,
    load: (_query, validation) => load({ ...query }, validation),
  };
  return createPersistentCache(cacheOptions);
}

function createConnectionsCacheInternal(
  options: ConnectionsCacheOptions,
  validated: { environment: string; teamName?: string },
): ConnectionsCache {
  const { environment, teamName } = validated;
  const { load } = options;
  const key = JSON.stringify([teamName ?? null]);
  return createSessionCache({
    namespace: JSON.stringify([oomolNamespaces.connections, environment]),
    schemaVersion: options.schemaVersion,
    maxAge: options.maxAge,
    sessionId: options.sessionId,
    key: () => key,
    decode: options.decode,
    load: (_query, validation) => load({ teamName }, validation),
  });
}

function validateOomolOptions(options: {
  readonly environment?: unknown;
  readonly locale?: unknown;
  readonly load?: unknown;
}): string {
  const environment = normalizeEnvironment(options.environment);
  if (typeof options.locale !== "string" || !options.locale.trim()) throw new TypeError("locale must be nonempty");
  if (typeof options.load !== "function") throw new TypeError("load must be a function");
  return environment;
}

function normalizeEnvironment(value: unknown): string {
  const environment = value === undefined ? "production" : value;
  if (typeof environment !== "string" || !environment.trim()) throw new TypeError("environment must be nonempty");
  return environment;
}

function normalizeTeamName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new TypeError("teamName must be nonempty");
  return value;
}

function validateConnectionsOptions(options: {
  readonly environment?: unknown;
  readonly sessionId?: unknown;
  readonly teamName?: unknown;
  readonly load?: unknown;
}): { environment: string; teamName?: string } {
  const environment = normalizeEnvironment(options.environment);
  if (typeof options.sessionId !== "string" || !options.sessionId.trim())
    throw new TypeError("sessionId must be nonempty");
  const teamName = normalizeTeamName(options.teamName);
  if (typeof options.load !== "function") throw new TypeError("load must be a function");
  return { environment, teamName };
}

/** Create an IndexedDB cache for the account-independent GET /v1/providers response, keyed by environment and locale. */
function createProvidersCacheInternal(options: ProvidersCacheOptions): OomolCache<ProvidersResponse> {
  return createOomolCache(oomolNamespaces.providers, options, { locale: options.locale });
}

/** Create an IndexedDB cache for account-independent GET /v1/actions?service=…, keyed by environment, locale and service. */
function createActionsCacheInternal(options: ActionsCacheOptions): ActionsCache {
  const environment = validateOomolOptions(options);
  const { locale, load } = options;
  return createPersistentCache<ActionsResponse, string>({
    namespace: JSON.stringify([oomolNamespaces.actions, environment]),
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

/** Create an IndexedDB cache for the account-independent GET /public/v1/apps response, keyed by environment and locale. */
function createAppCatalogCacheInternal(options: AppCatalogCacheOptions): OomolCache<AppCatalogResponse> {
  return createOomolCache(oomolNamespaces.appCatalog, options, { locale: options.locale });
}

function singletonKey(
  resource: string,
  options: { readonly environment?: string; readonly schemaVersion: number },
  query: unknown,
  sessionId?: string,
): string {
  const environment = normalizeEnvironment(options.environment);
  return sessionId === undefined
    ? JSON.stringify([resource, environment, options.schemaVersion, query])
    : JSON.stringify([resource, environment, options.schemaVersion, sessionId, query]);
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
        disposal = cache.dispose().then(
          () => {
            singletonCaches.delete(key);
          },
          (error) => {
            disposal = undefined;
            throw error;
          },
        );
      }
      return disposal;
    },
  };
  singletonCaches.set(key, singleton as ResourceCache<unknown, unknown>);
  return singleton;
}

/** Return the shared Providers cache for one environment, locale and schema version. */
export function getProvidersCache(options: ProvidersCacheOptions): OomolCache<ProvidersResponse> {
  const query = { locale: options.locale };
  return getSingleton(singletonKey(oomolNamespaces.providers, options, query), () =>
    createProvidersCacheInternal(options),
  );
}

/** Return the shared Actions cache for one environment, locale and schema version. */
export function getActionsCache(options: ActionsCacheOptions): ActionsCache {
  const query = { locale: options.locale };
  return getSingleton(singletonKey(oomolNamespaces.actions, options, query), () => createActionsCacheInternal(options));
}

/** Return the shared App Catalog cache for one environment, locale and schema version. */
export function getAppCatalogCache(options: AppCatalogCacheOptions): OomolCache<AppCatalogResponse> {
  const query = { locale: options.locale };
  return getSingleton(singletonKey(oomolNamespaces.appCatalog, options, query), () =>
    createAppCatalogCacheInternal(options),
  );
}

/** Return the shared sessionStorage cache for one login session and team scope. */
export function getConnectionsCache(options: ConnectionsCacheOptions): ConnectionsCache {
  const validated = validateConnectionsOptions(options);
  const query = { teamName: validated.teamName };
  return getSingleton(singletonKey(oomolNamespaces.connections, options, query, options.sessionId), () =>
    createConnectionsCacheInternal(options, validated),
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

export type ConnectionStatus = "active" | "reauth_required" | "error" | "disconnected";
export type ConnectionAuthType = CredentialAuthType | "marketplace";

export interface ConnectionCredentialField {
  key: string;
  label: string;
  displayValue: string;
  secret: boolean;
}

export interface ConnectionCredentialSummary {
  authType: "api_key" | "custom_credential";
  fields: Record<
    string,
    {
      configured: boolean;
      displayValue?: string;
      maskedValue?: string;
    }
  >;
}

export interface ConnectionTriggerCallbackUrl {
  service: string;
  deliveryMode: "push";
  url: string;
}

export interface ConnectionAppRecord {
  id: string;
  service: string;
  providerAccountId: string;
  accountLabel: string;
  alias: string | null;
  aliasNormalized: string | null;
  comment: string | null;
  scopes: string[];
  status: ConnectionStatus;
  createdAt: number;
  updatedAt: number;
  userId: string;
  createdByUserId: string;
  ownerType: "team";
  ownerTeamId: string;
  authType: ConnectionAuthType | null;
  providerScopes?: string[];
  displayName: string;
  isDefault: boolean;
  credentialFields?: ConnectionCredentialField[];
  credentialSummary?: ConnectionCredentialSummary;
  triggerCallbackUrls?: ConnectionTriggerCallbackUrl[];
  marketplace?: {
    id: string;
    pricing: "free" | "metered";
  };
}

export interface ConnectionsSummary {
  providerCount: number;
  connectableProviderCount: number;
  connectedProviderCount: number;
  activeConnectedProviderCount: number;
  connectedAppCount: number;
  activeConnectedAppCount: number;
  filteredAppCount: number;
}

/** Complete GET /v1/connections success response, including connection summary metadata. */
export interface ConnectionsResponse {
  success: true;
  message: string;
  data: ConnectionAppRecord[];
  meta: { summary: ConnectionsSummary };
}
