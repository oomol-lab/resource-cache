import { vi } from "vitest";
import type { CacheOptions, LoadResult } from "../src/index";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export const modified = <T>(data: T, etag: string | null = '"v1"'): LoadResult<T> => ({ modified: true, data, etag });

export function options(overrides: Partial<CacheOptions<string, string>> = {}): CacheOptions<string, string> {
  return {
    namespace: "test",
    schemaVersion: 1,
    maxAge: 100,
    key: (query) => query,
    decode: vi.fn((value) => {
      if (typeof value !== "string") throw new Error("Invalid data");
      return value;
    }),
    load: vi.fn(async () => modified("one")),
    ...overrides,
  };
}

export class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

// Advance promise continuations only, without fake IDB timers or wall-clock sleeps.
export async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Expected promise progress did not occur");
}
