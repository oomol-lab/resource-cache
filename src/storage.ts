/** @internal */
export interface Metadata {
  version: string;
  etag: string | null;
  validatedAt: number;
  invalidated: boolean;
}

/** @internal */
export interface Entry<T> extends Metadata {
  data: T;
}

/** An absent body means that the caller already has this version. @internal */
export interface Stored {
  meta: Metadata;
  body?: { data: unknown };
}

/** @internal */
export interface CompleteStored extends Stored {
  body: { data: unknown };
}

/** @internal */
export interface StorageBackend {
  read(key: string, version?: string): Promise<Stored | undefined>;
  /** False means a conditional update skipped a missing or replaced response. */
  write(key: string, entry: Entry<unknown>, modified: boolean): Promise<boolean>;
  invalidate(key: string): Promise<Stored | undefined>;
  remove(key: string): Promise<void>;
  clear(allVersions: boolean): Promise<void>;
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function metadata(value: unknown): Metadata | undefined {
  if (
    !object(value) ||
    typeof value.version !== "string" ||
    !value.version ||
    !(value.etag === null || typeof value.etag === "string") ||
    typeof value.invalidated !== "boolean"
  )
    return undefined;
  const validTime =
    typeof value.validatedAt === "number" && Number.isFinite(value.validatedAt) && value.validatedAt >= 0;
  return {
    version: value.version,
    etag: value.etag,
    validatedAt: validTime ? (value.validatedAt as number) : 0,
    invalidated: !validTime || value.invalidated === true,
  };
}

export function stored(meta: Metadata, body: unknown): CompleteStored | undefined {
  if (!object(body) || body.version !== meta.version || !Object.hasOwn(body, "data")) return undefined;
  return { meta, body: { data: body.data } };
}

export const storagePrefix = "@oomol-lab/resource-cache:";

/** JSON arrays delimit identity fields without ambiguous string concatenation. @internal */
export function scope(namespace: string, sessionId?: string): string {
  return storagePrefix + JSON.stringify([namespace, sessionId]);
}
