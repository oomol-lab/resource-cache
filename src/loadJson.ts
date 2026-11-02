import type { CacheValidation, LoadResult } from "./types";

/** Conditional JSON GET. The caller owns the endpoint, credentials, timeout and response decoder. */
export async function loadJson<T>(
  url: string | URL,
  validation: CacheValidation,
  decode: (value: unknown) => T,
  init?: Omit<RequestInit, "method" | "body">,
): Promise<LoadResult<T>> {
  const headers = new Headers(init?.headers);
  if (validation.etag !== null) headers.set("If-None-Match", validation.etag);
  else headers.delete("If-None-Match");
  const response = await fetch(url, {
    ...init,
    method: "GET",
    headers,
    signal: init?.signal ? AbortSignal.any([validation.signal, init.signal]) : validation.signal,
  });
  if (response.status === 304) return { modified: false, etag: response.headers.get("ETag") ?? undefined };
  if (!response.ok) throw new Error(`JSON request failed: ${response.status}`);
  return { modified: true, data: decode(await response.json()), etag: response.headers.get("ETag") };
}
