/** Validators passed to the host's request layer. */
export interface CacheValidation {
  readonly etag: string | null;
  readonly signal: AbortSignal;
}

/** A complete response, or confirmation of the response identified by the supplied ETag. */
export type LoadResult<T> =
  | { readonly modified: true; readonly data: T; readonly etag: string | null }
  | { readonly modified: false; readonly etag?: string | null };

export interface CacheOptions<T, Q> {
  /** Nonempty identity for a resource and its data environment. */
  readonly namespace: string;
  /** Positive safe integer; increment for incompatible decoding contracts. */
  readonly schemaVersion: number;
  /** Finite nonnegative milliseconds. Zero always requires validation. */
  readonly maxAge: number;
  /**
   * Stable response identity. Authentication, locale and resource scope belong here only when they change the response.
   * The OOMOL catalog factories are account-independent and define their own identity.
   */
  readonly key: (query: Q) => string;
  /** Restore stored data. Throwing treats that record as a cache miss. */
  readonly decode: (value: unknown) => T;
  /** Load or conditionally validate a complete response. */
  readonly load: (query: Q, validation: CacheValidation) => Promise<LoadResult<T>>;
}

export interface SessionCacheOptions<T, Q> extends CacheOptions<T, Q> {
  /** Nonempty, non-secret login identifier; never use an access token. */
  readonly sessionId: string;
}

export interface CacheSnapshot<T> {
  readonly data: T;
  readonly etag: string | null;
  /** Unix milliseconds. Invalid or missing stored timestamps are reported as zero and stale. */
  readonly validatedAt: number;
  readonly fresh: boolean;
}

export interface CacheGetOptions {
  /** Require a validation started after this call, even when cached data is fresh. */
  readonly revalidate?: boolean;
  /** Cancel this caller's wait without canceling shared work. */
  readonly signal?: AbortSignal;
}

export interface ResourceCache<T, Q> {
  /** Return fresh data or await loading. Data must be treated as read-only. */
  get(query: Q, options?: CacheGetOptions): Promise<T>;
  /** Read without loading; may return stale data. */
  peek(query: Q): Promise<CacheSnapshot<T> | undefined>;
  /** Retain data and ETag, mark stale, and reject this instance's older calls. */
  invalidate(query: Q): Promise<void>;
  /** Delete data and validators, rejecting this instance's older calls. */
  remove(query: Q): Promise<void>;
  /** Clear this namespace/schema/session scope, rejecting this instance's older calls. */
  clear(): Promise<void>;
  /** Close immediately. Persistent data survives; session data for all schema versions is removed.
   * Repeated calls are idempotent after success and retry session cleanup after failure.
   */
  dispose(): Promise<void>;
}
