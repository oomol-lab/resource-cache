import { createCache, validateOptions } from "./cache";
import { persistentStorage } from "./persistent";
import { sessionStorageBackend } from "./session";
import type { CacheOptions, ResourceCache, SessionCacheOptions } from "./types";

export type {
  CacheGetOptions,
  CacheOptions,
  CacheSnapshot,
  CacheValidation,
  LoadResult,
  ResourceCache,
  SessionCacheOptions,
} from "./types";

/** Create an IndexedDB cache. Storage failures preserve successful network results. */
export function createPersistentCache<T, Q>(options: CacheOptions<T, Q>): ResourceCache<T, Q> {
  validateOptions(options);
  return createCache({ ...options }, persistentStorage(options.namespace, options.schemaVersion), false);
}

/** Create a login-scoped sessionStorage cache. Data must survive JSON serialization and decoding. */
export function createSessionCache<T, Q>(options: SessionCacheOptions<T, Q>): ResourceCache<T, Q> {
  validateOptions(options);
  if (typeof options.sessionId !== "string" || !options.sessionId.trim())
    throw new TypeError("sessionId must be nonempty");
  return createCache(
    { ...options },
    sessionStorageBackend(options.namespace, options.schemaVersion, options.sessionId),
    true,
  );
}
