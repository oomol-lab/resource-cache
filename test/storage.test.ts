import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createStore, del, get, keys, set } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CacheOptions, createPersistentCache, createSessionCache, type LoadResult } from "../src/index";
import { deferred, MemoryStorage, modified, options } from "./helpers";

let webStorage: MemoryStorage;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  webStorage = new MemoryStorage();
  vi.stubGlobal("sessionStorage", webStorage);
  vi.spyOn(Date, "now").mockReturnValue(1_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const factories = {
  persistent: createPersistentCache<string, string>,
  session: (opts: CacheOptions<string, string>) => createSessionCache({ ...opts, sessionId: "login" }),
};

function present<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, "Storage fixture must exist");
  return value;
}

async function fixture(
  kind: string,
  metaChange: (meta: Record<string, unknown>) => unknown,
  bodyChange?: (body: Record<string, unknown>) => unknown,
) {
  const opts = options();
  const factory = factories[kind as keyof typeof factories];
  await factory(opts).get("q");
  if (kind === "session") {
    const key = present(webStorage.key(0));
    const raw: Record<string, unknown> = JSON.parse(present(webStorage.getItem(key)));
    const meta = metaChange(raw);
    const body = bodyChange?.(raw);
    webStorage.setItem(
      key,
      JSON.stringify(bodyChange && typeof meta === "object" ? { ...meta, ...(body as object) } : meta),
    );
  } else {
    const store = createStore("@oomol-lab/resource-cache", "records");
    const allKeys = await keys<string>(store);
    const metaKey = present(allKeys.find((key) => key.endsWith(',"meta"]')));
    const bodyKey = present(allKeys.find((key) => key.endsWith(',"body"]')));
    const meta = await get<Record<string, unknown>>(metaKey, store);
    await set(metaKey, metaChange(present(meta)), store);
    if (bodyChange) await set(bodyKey, bodyChange(present(await get<Record<string, unknown>>(bodyKey, store))), store);
  }
  return { opts, factory, cache: factory(opts) };
}

describe.each(Object.entries(factories))("%s storage faults", (kind, factory) => {
  it("an unpersisted memory version is retained across expiry and invalidation", async () => {
    const opts = options();
    const cache = factory(opts);
    await cache.get("q");
    const saving =
      kind === "persistent"
        ? vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
            throw new Error("quota");
          })
        : vi.spyOn(webStorage, "setItem").mockImplementation(() => {
            throw new Error("quota");
          });
    vi.mocked(opts.load).mockResolvedValueOnce(modified("newest", '"v2"'));
    expect(await cache.get("q", { revalidate: true })).toBe("newest");
    saving.mockRestore();
    vi.mocked(Date.now).mockReturnValue(1_100);
    expect(await cache.peek("q")).toMatchObject({ data: "newest", etag: '"v2"', fresh: false });
    await cache.invalidate("q");
    expect(await cache.peek("q")).toMatchObject({ data: "newest", etag: '"v2"', fresh: false });
    vi.mocked(opts.load).mockResolvedValueOnce(modified("saved", '"v3"'));
    expect(await cache.get("q")).toBe("saved");
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: '"v2"', signal: expect.any(AbortSignal) });
    expect(await factory(opts).peek("q")).toMatchObject({ data: "saved" });
  });

  it("a skipped 304 update cannot lift a cleanup barrier after an earlier persistence failure", async () => {
    const opts = options();
    const cache = factory(opts);
    await cache.get("q");
    const deletion =
      kind === "persistent"
        ? vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => {
            throw new Error("denied");
          })
        : vi.spyOn(webStorage, "removeItem").mockImplementation(() => {
            throw new Error("denied");
          });
    await expect(cache.remove("q")).rejects.toThrow("denied");
    deletion.mockRestore();
    const saving =
      kind === "persistent"
        ? vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
            throw new Error("quota");
          })
        : vi.spyOn(webStorage, "setItem").mockImplementation(() => {
            throw new Error("quota");
          });
    vi.mocked(opts.load).mockResolvedValueOnce(modified("newest"));
    expect(await cache.get("q")).toBe("newest");
    saving.mockRestore();
    vi.mocked(opts.load).mockResolvedValueOnce({ modified: false });
    expect(await cache.get("q", { revalidate: true })).toBe("newest");
    vi.mocked(Date.now).mockReturnValue(1_100);
    expect(await cache.peek("q")).toMatchObject({ data: "newest", fresh: false });
    expect(await factory(opts).peek("q")).toMatchObject({ data: "one" });
  });

  it.each([
    {
      name: "missing timestamp",
      change: (v: Record<string, unknown>) => {
        const { validatedAt: _time, ...rest } = v;
        return rest;
      },
    },
    { name: "negative timestamp", change: (v: Record<string, unknown>) => ({ ...v, validatedAt: -1 }) },
    { name: "nonnumeric timestamp", change: (v: Record<string, unknown>) => ({ ...v, validatedAt: "1000" }) },
    { name: "infinite timestamp", change: (v: Record<string, unknown>) => ({ ...v, validatedAt: Infinity }) },
  ])("$name keeps usable data stale with normalized time", async ({ change }) => {
    const { cache, opts } = await fixture(kind, change);
    expect(await cache.peek("q")).toEqual({ data: "one", etag: '"v1"', validatedAt: 0, fresh: false });
    await cache.get("q");
    expect(opts.load).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "null record", change: () => null },
    { name: "primitive record", change: () => "broken" },
    { name: "missing response version", change: (v: Record<string, unknown>) => ({ ...v, version: undefined }) },
    { name: "empty response version", change: (v: Record<string, unknown>) => ({ ...v, version: "" }) },
    { name: "invalid ETag", change: (v: Record<string, unknown>) => ({ ...v, etag: 1 }) },
    { name: "invalid invalidation marker", change: (v: Record<string, unknown>) => ({ ...v, invalidated: "true" }) },
  ])("$name is a miss and invalidate cannot manufacture data", async ({ change }) => {
    const { cache, opts } = await fixture(kind, change);
    expect(await cache.peek("q")).toBeUndefined();
    await cache.invalidate("q");
    expect(await cache.peek("q")).toBeUndefined();
    await cache.get("q");
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: null, signal: expect.any(AbortSignal) });
  });

  it("undecodable data is a miss, including when invalidating an unloaded key", async () => {
    const { cache, opts } = await fixture(
      kind,
      (v) => v,
      (v) => ({ ...v, data: 42 }),
    );
    expect(await cache.peek("q")).toBeUndefined();
    await cache.invalidate("q");
    expect(await cache.peek("q")).toBeUndefined();
    await cache.get("q");
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: null, signal: expect.any(AbortSignal) });
  });

  it("a late 304 does not overwrite another instance's complete response", async () => {
    const opts = options();
    const a = factory(opts);
    await a.get("q");
    const pending = deferred<LoadResult<string>>();
    vi.mocked(opts.load).mockReturnValueOnce(pending.promise);
    const validation = a.get("q", { revalidate: true });
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(2));
    const b = factory(opts);
    vi.mocked(opts.load).mockResolvedValueOnce(modified("replacement", '"v2"'));
    await b.get("q", { revalidate: true });
    pending.resolve({ modified: false, etag: '"old-validator"' });
    expect(await validation).toBe("one");
    expect(await factory(opts).peek("q")).toMatchObject({ data: "replacement", etag: '"v2"' });
  });

  it("a late 304 does not resurrect data removed by another instance", async () => {
    const opts = options();
    const a = factory(opts);
    await a.get("q");
    const pending = deferred<LoadResult<string>>();
    vi.mocked(opts.load).mockReturnValueOnce(pending.promise);
    const validation = a.get("q", { revalidate: true });
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(2));
    await factory(opts).remove("q");
    pending.resolve({ modified: false });
    expect(await validation).toBe("one");
    expect(await factory(opts).peek("q")).toBeUndefined();
  });

  it("unavailable storage still permits loading and fresh memory reuse, but reports cleanup failure", async () => {
    vi.stubGlobal(kind === "persistent" ? "indexedDB" : "sessionStorage", undefined);
    const opts = options();
    const cache = factory(opts);
    expect(await cache.peek("q")).toBeUndefined();
    expect(await cache.get("q")).toBe("one");
    expect(await cache.get("q")).toBe("one");
    expect(opts.load).toHaveBeenCalledTimes(1);
    await expect(cache.remove("q")).rejects.toThrow();
    expect(await cache.peek("q")).toBeUndefined();
    await expect(cache.clear()).rejects.toThrow();
    if (kind === "persistent") await cache.dispose();
    else await expect(cache.dispose()).rejects.toThrow();
  });
});

describe("IndexedDB atomicity and layout", () => {
  it.each([
    "remove",
    "clear",
  ] as const)("failed %s rolls back partial deletion and keeps a local barrier", async (method) => {
    const opts = options();
    const cache = createPersistentCache(opts);
    await cache.get("q");
    const original = IDBObjectStore.prototype.delete;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "delete")
      .mockImplementationOnce(function (this: IDBObjectStore, key) {
        return original.call(this, key);
      })
      .mockImplementationOnce(() => {
        throw new Error("delete failure");
      });
    await expect(cache[method]("q")).rejects.toThrow("delete failure");
    spy.mockRestore();
    expect(await cache.peek("q")).toBeUndefined();
    expect(await createPersistentCache(opts).peek("q")).toMatchObject({ data: "one" });
  });

  it("failed invalidation leaves stored validators intact while local data stays stale", async () => {
    const opts = options();
    const cache = createPersistentCache(opts);
    await cache.get("q");
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new Error("write failure");
    });
    await expect(cache.invalidate("q")).rejects.toThrow("write failure");
    spy.mockRestore();
    expect(await cache.peek("q")).toMatchObject({ fresh: false });
    expect(await createPersistentCache(opts).peek("q")).toMatchObject({ fresh: true });
  });

  it("rolls back metadata when the body cannot be structured-cloned", async () => {
    const opts = options();
    const original = createPersistentCache(opts);
    await original.get("q");
    const callable = () => "not cloneable";
    const cache = createPersistentCache({ ...opts, decode: (v) => v, load: async () => modified(callable) });
    expect(await cache.get("q", { revalidate: true })).toBe(callable);
    expect(await createPersistentCache(opts).peek("q")).toMatchObject({ data: "one", etag: '"v1"' });
    expect((await cache.peek("q"))?.data).toBe(callable);
  });

  it("reads only metadata when the in-memory response version matches", async () => {
    const opts = options({ maxAge: 0 });
    const cache = createPersistentCache(opts);
    await cache.get("q");
    const read = vi.spyOn(IDBObjectStore.prototype, "get");
    await cache.peek("q");
    expect(read.mock.calls.map(([key]) => key)).toHaveLength(1);
    expect(read.mock.calls[0][0]).toMatch(/,"meta"\]$/);
  });

  it.each(["missing", "null", "mismatched", "no-data"])("treats a %s body as a miss", async (condition) => {
    const opts = options();
    await createPersistentCache(opts).get("q");
    const store = createStore("@oomol-lab/resource-cache", "records");
    const bodyKey = present((await keys<string>(store)).find((key) => key.endsWith(',"body"]')));
    if (condition === "missing") await del(bodyKey, store);
    else if (condition === "null") await set(bodyKey, null, store);
    else {
      const body = present(await get<Record<string, unknown>>(bodyKey, store));
      await set(bodyKey, condition === "mismatched" ? { ...body, version: "other" } : { version: body.version }, store);
    }
    const cache = createPersistentCache(opts);
    expect(await cache.peek("q")).toBeUndefined();
    await cache.get("q");
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: null, signal: expect.any(AbortSignal) });
  });

  it("clear retains unrelated records and nonstring IDB keys", async () => {
    const opts = options();
    const cache = createPersistentCache(opts);
    await cache.get("q");
    const store = createStore("@oomol-lab/resource-cache", "records");
    await set(7, "outside", store);
    await set("unrelated", "outside", store);
    await cache.clear();
    expect(await keys(store)).toEqual([7, "unrelated"]);
  });

  it("a failed IDB read transaction is a miss and can recover on the next operation", async () => {
    const opts = options();
    await createPersistentCache(opts).get("q");
    const original = IDBObjectStore.prototype.get;
    const spy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(function (this: IDBObjectStore, key) {
      const request = original.call(this, key);
      this.transaction.abort();
      return request;
    });
    const cache = createPersistentCache(opts);
    expect(await cache.peek("q")).toBeUndefined();
    spy.mockRestore();
    expect(await cache.peek("q")).toMatchObject({ data: "one" });
  });
});

describe("sessionStorage lifecycle and JSON", () => {
  it("dispose clears all schemas for one namespace/login and preserves other logins", async () => {
    const opts = options();
    const factory = (namespace: string, schemaVersion: number, sessionId: string) =>
      createSessionCache({ ...opts, namespace, schemaVersion, sessionId });
    await factory("a", 1, "login").get("q");
    await factory("a", 2, "login").get("q");
    await factory("a", 1, "other").get("q");
    await factory("b", 1, "login").get("q");
    await factory("a", 1, "login").dispose();
    expect(await factory("a", 1, "login").peek("q")).toBeUndefined();
    expect(await factory("a", 2, "login").peek("q")).toBeUndefined();
    expect(await factory("a", 1, "other").peek("q")).toMatchObject({ data: "one" });
    expect(await factory("b", 1, "login").peek("q")).toMatchObject({ data: "one" });
  });

  it("persistent dispose retains durable data", async () => {
    const opts = options();
    const cache = createPersistentCache(opts);
    await cache.get("q");
    await cache.dispose();
    expect(await createPersistentCache(opts).peek("q")).toMatchObject({ data: "one" });
  });

  it("malformed JSON is a miss", async () => {
    const opts = options();
    await factories.session(opts).get("q");
    webStorage.setItem(present(webStorage.key(0)), "{");
    expect(await factories.session(opts).peek("q")).toBeUndefined();
  });

  it("JSON serialization failure preserves the successful result in memory", async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const cache = createSessionCache({
      ...options(),
      sessionId: "login",
      decode: (v) => v,
      load: async () => modified(circular),
    });
    expect(await cache.get("q")).toBe(circular);
    expect((await cache.peek("q"))?.data).toBe(circular);
    expect(webStorage.length).toBe(0);
  });

  it("304 retains the original JSON body when decode restores a different runtime shape", async () => {
    const opts = {
      ...options(),
      sessionId: "login",
      decode: (v: unknown) => ({ restored: v }),
      load: vi.fn<() => Promise<LoadResult<unknown>>>().mockResolvedValueOnce(modified("wire")),
    };
    await createSessionCache(opts).get("q");
    const cache = createSessionCache(opts);
    expect(await cache.get("q")).toEqual({ restored: "wire" });
    opts.load.mockResolvedValueOnce({ modified: false });
    expect(await cache.get("q", { revalidate: true })).toEqual({ restored: "wire" });
    expect(await createSessionCache(opts).get("q")).toEqual({ restored: "wire" });
  });

  it.each([
    "remove",
    "clear",
  ] as const)("failed %s cannot expose or reuse old storage in the same instance", async (method) => {
    const opts = options();
    const cache = factories.session(opts);
    await cache.get("q");
    const fail = vi.spyOn(webStorage, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await expect(cache[method]("q")).rejects.toThrow("denied");
    expect(await cache.peek("q")).toBeUndefined();
    expect(await factories.session(opts).peek("q")).toMatchObject({ data: "one" });
    fail.mockRestore();
    await cache.get("q");
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: null, signal: expect.any(AbortSignal) });
    expect(await cache.peek("q")).toMatchObject({ fresh: true });
  });

  it("failed invalidation keeps local data stale even though stored metadata remains fresh", async () => {
    const opts = options();
    const cache = factories.session(opts);
    await cache.get("q");
    const fail = vi.spyOn(webStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(cache.invalidate("q")).rejects.toThrow("quota");
    expect(await cache.peek("q")).toMatchObject({ data: "one", fresh: false });
    expect(await factories.session(opts).peek("q")).toMatchObject({ fresh: true });
    fail.mockRestore();
    await cache.get("q");
    expect(opts.load).toHaveBeenCalledTimes(2);
  });

  it("failed disposal stays closed and repeated disposal retries deletion", async () => {
    const opts = options();
    const cache = factories.session(opts);
    await cache.get("q");
    const fail = vi.spyOn(webStorage, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await expect(cache.dispose()).rejects.toThrow("denied");
    await expect(cache.get("q")).rejects.toThrow("disposed");
    fail.mockRestore();
    await cache.dispose();
    expect(webStorage.length).toBe(0);
    await cache.dispose();
  });

  it("storage getter and write exceptions do not replace successful network results", async () => {
    const opts = options();
    const cache = factories.session(opts);
    const fail = vi.spyOn(webStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(webStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(await cache.get("q")).toBe("one");
    fail.mockRestore();
    expect(await cache.get("q")).toBe("one");
    expect(opts.load).toHaveBeenCalledTimes(1);
  });
});
