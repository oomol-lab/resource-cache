import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CacheOptions, createPersistentCache, createSessionCache, type LoadResult } from "../src/index";
import { deferred, MemoryStorage, modified, options } from "./helpers";

const factories = {
  persistent: createPersistentCache<string, string>,
  session: (opts: CacheOptions<string, string>) => createSessionCache({ ...opts, sessionId: "login" }),
};

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.spyOn(Date, "now").mockReturnValue(1_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(Object.entries(factories))("%s cache contract", (_name, factory) => {
  it("loads once, exposes validators, and reuses fresh memory without decoding", async () => {
    const opts = options();
    const cache = factory(opts);
    expect(await cache.peek("q")).toBeUndefined();
    expect(await cache.get("q")).toBe("one");
    expect(await cache.get("q")).toBe("one");
    expect(await cache.peek("q")).toEqual({ data: "one", etag: '"v1"', validatedAt: 1_000, fresh: true });
    expect(opts.load).toHaveBeenCalledTimes(1);
    expect(opts.load).toHaveBeenCalledWith("q", { etag: null, signal: expect.any(AbortSignal) });
    expect(opts.decode).not.toHaveBeenCalled();
  });

  it("generates response identities without requiring secure-context randomUUID", async () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const cache = factory(options());
    expect(await cache.get("q")).toBe("one");
    expect(await factory(options()).peek("q")).toMatchObject({ data: "one" });
  });

  it("restores complete responses in a new instance and refreshes at the exact TTL boundary", async () => {
    const opts = options();
    await factory(opts).get("q");
    vi.mocked(Date.now).mockReturnValue(1_099);
    const restored = factory(opts);
    expect(await restored.get("q")).toBe("one");
    expect(opts.decode).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(1_100);
    vi.mocked(opts.load).mockResolvedValueOnce(modified("two", '"v2"'));
    expect(await restored.get("q")).toBe("two");
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: '"v1"', signal: expect.any(AbortSignal) });
    expect(await restored.peek("q")).toMatchObject({ etag: '"v2"', validatedAt: 1_100 });
  });

  it("maxAge zero validates every access, while peek never loads", async () => {
    const opts = options({ maxAge: 0 });
    const cache = factory(opts);
    await cache.get("q");
    await cache.peek("q");
    expect(opts.load).toHaveBeenCalledTimes(1);
    expect(await cache.peek("q")).toMatchObject({ fresh: false });
    await cache.get("q");
    expect(opts.load).toHaveBeenCalledTimes(2);
  });

  it("clock rollback treats future validations as stale", async () => {
    const opts = options();
    const cache = factory(opts);
    await cache.get("q");
    vi.mocked(Date.now).mockReturnValue(999);
    expect(await cache.peek("q")).toMatchObject({ fresh: false });
    await cache.get("q");
    expect(opts.load).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, '"new"'])("304 preserves data and applies ETag %s", async (etag) => {
    const opts = options();
    const cache = factory(opts);
    await cache.get("q");
    vi.mocked(Date.now).mockReturnValue(1_010);
    vi.mocked(opts.load).mockResolvedValueOnce({ modified: false, etag });
    expect(await cache.get("q", { revalidate: true })).toBe("one");
    const expected = etag === undefined ? '"v1"' : etag;
    expect(await cache.peek("q")).toMatchObject({ etag: expected, validatedAt: 1_010, fresh: true });
    expect(await factory(opts).peek("q")).toMatchObject({ etag: expected, validatedAt: 1_010 });
  });

  it("rejects an unmodified response without data", async () => {
    const opts = options({ load: vi.fn(async () => ({ modified: false as const })) });
    const cache = factory(opts);
    await expect(cache.get("q")).rejects.toThrow("protocol error");
    expect(await cache.peek("q")).toBeUndefined();
  });

  it("failed loads retain stale data and do not extend its validation time", async () => {
    const opts = options();
    const cache = factory(opts);
    await cache.get("q");
    vi.mocked(Date.now).mockReturnValue(1_100);
    vi.mocked(opts.load).mockRejectedValueOnce(new Error("offline"));
    await expect(cache.get("q")).rejects.toThrow("offline");
    expect(await cache.peek("q")).toEqual({ data: "one", etag: '"v1"', validatedAt: 1_000, fresh: false });
    expect(await cache.get("q")).toBe("one");
  });

  it("reuses another instance's metadata-only validation without decoding the body again", async () => {
    const opts = options();
    const a = factory(opts);
    const b = factory(opts);
    await a.get("q");
    await b.get("q");
    vi.mocked(Date.now).mockReturnValue(1_100);
    vi.mocked(opts.load).mockResolvedValueOnce({ modified: false });
    await b.get("q");
    const decodes = vi.mocked(opts.decode).mock.calls.length;
    expect(await a.get("q")).toBe("one");
    expect(opts.load).toHaveBeenCalledTimes(2);
    expect(opts.decode).toHaveBeenCalledTimes(decodes);
    expect(await a.peek("q")).toMatchObject({ validatedAt: 1_100, fresh: true });
  });

  it("reads a new body when another instance replaces the stored version", async () => {
    const opts = options();
    const a = factory(opts);
    const b = factory(opts);
    await a.get("q");
    vi.mocked(Date.now).mockReturnValue(1_100);
    vi.mocked(opts.load).mockResolvedValueOnce(modified("two"));
    await b.get("q");
    expect(await a.get("q")).toBe("two");
    expect(opts.load).toHaveBeenCalledTimes(2);
  });

  it("invalidate preserves data/validators and stale state across instances, even at epoch zero", async () => {
    vi.mocked(Date.now).mockReturnValue(0);
    const opts = options();
    const a = factory(opts);
    await a.get("q");
    await a.invalidate("q");
    expect(await a.peek("q")).toEqual({ data: "one", etag: '"v1"', validatedAt: 0, fresh: false });
    const b = factory(opts);
    expect(await b.peek("q")).toMatchObject({ fresh: false, data: "one" });
    await b.get("q");
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: '"v1"', signal: expect.any(AbortSignal) });
    await a.get("q");
    expect(await a.peek("q")).toMatchObject({ fresh: true });
  });

  it("invalidate restores previously unloaded data; nonexistent keys stay absent", async () => {
    const opts = options();
    await factory(opts).get("q");
    const cache = factory(opts);
    await cache.invalidate("q");
    expect(await cache.peek("q")).toMatchObject({ data: "one", fresh: false });
    await cache.invalidate("absent");
    expect(await cache.peek("absent")).toBeUndefined();
  });

  it("remove deletes both data and validators while retaining other keys", async () => {
    const opts = options();
    const cache = factory(opts);
    await cache.get("a");
    await cache.get("b");
    await cache.remove("a");
    expect(await cache.peek("a")).toBeUndefined();
    expect(await factory(opts).peek("a")).toBeUndefined();
    expect(await cache.peek("b")).toMatchObject({ data: "one" });
    await cache.get("a");
    expect(opts.load).toHaveBeenLastCalledWith("a", { etag: null, signal: expect.any(AbortSignal) });
  });

  it("clear is scoped to namespace/schema, including unloaded keys, and does not wipe unrelated storage", async () => {
    const opts = options();
    const a = factory(opts);
    await a.get("a");
    await factory(opts).get("unloaded");
    const otherNamespace = factory({ ...opts, namespace: "other" });
    const otherSchema = factory({ ...opts, schemaVersion: 2 });
    await otherNamespace.get("a");
    await otherSchema.get("a");
    globalThis.sessionStorage.setItem("unrelated", "keep");
    await a.clear();
    expect(await a.peek("a")).toBeUndefined();
    expect(await factory(opts).peek("unloaded")).toBeUndefined();
    expect(await factory({ ...opts, namespace: "other" }).peek("a")).toMatchObject({ data: "one" });
    expect(await factory({ ...opts, schemaVersion: 2 }).peek("a")).toMatchObject({ data: "one" });
    expect(globalThis.sessionStorage.getItem("unrelated")).toBe("keep");
    await a.get("a");
    expect(await a.peek("a")).toMatchObject({ fresh: true });
  });

  it("identity encoding handles delimiters, quotes, empty queries, and Unicode", async () => {
    const opts = options();
    const a = factory({ ...opts, namespace: 'a:1:["b"]' });
    const b = factory({ ...opts, namespace: "a" });
    await a.get("b");
    expect(await b.peek('1:["b"]:b')).toBeUndefined();
    await a.get("");
    await a.get('中文:"[]');
    await a.remove("b");
    expect(await a.peek("")).toMatchObject({ data: "one" });
    expect(await factory({ ...opts, namespace: opts.namespace }).peek("b")).toBeUndefined();
  });

  it("coalesces ordinary callers but runs distinct keys independently", async () => {
    const pending = deferred<LoadResult<string>>();
    const opts = options({ load: vi.fn(() => pending.promise) });
    const cache = factory(opts);
    const calls = [cache.get("a"), cache.get("a"), cache.get("b")];
    // IDB's event loop progresses naturally; waitFor is only a progress barrier.
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(2));
    pending.resolve(modified("loaded"));
    expect(await Promise.all(calls)).toEqual(["loaded", "loaded", "loaded"]);
  });

  it("queues forced callers behind started work, joining forces before the next request begins", async () => {
    const first = deferred<LoadResult<string>>();
    const second = deferred<LoadResult<string>>();
    const opts = options({ load: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
    const cache = factory(opts);
    const ordinary = cache.get("q");
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(1));
    const forcedA = cache.get("q", { revalidate: true });
    const forcedB = cache.get("q", { revalidate: true });
    expect(opts.load).toHaveBeenCalledTimes(1);
    first.resolve(modified("old"));
    expect(await ordinary).toBe("old");
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(2));
    second.resolve(modified("new"));
    expect(await Promise.all([forcedA, forcedB])).toEqual(["new", "new"]);
    expect(opts.load).toHaveBeenLastCalledWith("q", { etag: '"v1"', signal: expect.any(AbortSignal) });
  });

  it("a failed earlier request does not discard the queued forced validation", async () => {
    const first = deferred<LoadResult<string>>();
    const opts = options({ load: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(modified("retry")) });
    const cache = factory(opts);
    const ordinary = expect(cache.get("q")).rejects.toThrow("failed");
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(1));
    const forced = cache.get("q", { revalidate: true });
    first.reject(new Error("failed"));
    await ordinary;
    expect(await forced).toBe("retry");
    expect(opts.load).toHaveBeenCalledTimes(2);
  });

  it("a force during storage lookup upgrades the pending round even when storage is fresh", async () => {
    const opts = options();
    await factory(opts).get("q");
    vi.mocked(opts.load).mockResolvedValueOnce(modified("validated"));
    const cache = factory(opts);
    const ordinary = cache.get("q");
    const forced = cache.get("q", { revalidate: true });
    expect(await Promise.all([ordinary, forced])).toEqual(["validated", "validated"]);
    expect(opts.load).toHaveBeenCalledTimes(2);
  });

  it("individual cancellation does not abort shared loading and removes listeners", async () => {
    const pending = deferred<LoadResult<string>>();
    const opts = options({ load: vi.fn(() => pending.promise) });
    const cache = factory(opts);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const canceled = expect(cache.get("q", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    const other = cache.get("q");
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(1));
    controller.abort("caller reason");
    await canceled;
    expect(vi.mocked(opts.load).mock.calls[0][1].signal.aborted).toBe(false);
    pending.resolve(modified("shared"));
    expect(await other).toBe("shared");
    expect(removeListener).toHaveBeenCalled();
    expect(await cache.peek("q")).toMatchObject({ data: "shared" });
  });

  it("already aborted callers never start work, including on a fresh memory hit", async () => {
    const opts = options();
    const cache = factory(opts);
    const signal = AbortSignal.abort();
    await expect(cache.get("q", { signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(opts.load).not.toHaveBeenCalled();
    await cache.get("q");
    await expect(cache.get("q", { signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(opts.load).toHaveBeenCalledTimes(1);
  });

  it.each([
    "invalidate",
    "remove",
    "clear",
    "dispose",
  ] as const)("%s rejects active and queued calls and blocks an abort-ignoring load", async (method) => {
    const pending = deferred<LoadResult<string>>();
    const opts = options({ load: vi.fn(() => pending.promise) });
    const cache = factory(opts);
    const canceled = expect(cache.get("q")).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(opts.load).toHaveBeenCalledTimes(1));
    const queued = expect(cache.get("q", { revalidate: true })).rejects.toMatchObject({ name: "AbortError" });
    await cache[method]("q");
    await Promise.all([canceled, queued]);
    expect(vi.mocked(opts.load).mock.calls[0][1].signal.aborted).toBe(true);
    pending.resolve(modified("late"));
    await Promise.resolve();
    // A new instance observes storage after any late continuation has run.
    expect(await factory(opts).peek("q")).toBeUndefined();
    expect(opts.load).toHaveBeenCalledTimes(1);
    if (method !== "dispose") {
      vi.mocked(opts.load).mockResolvedValueOnce(modified("current"));
      expect(await cache.get("q")).toBe("current");
    }
  });

  it("disposal is idempotent and every other method rejects after closing", async () => {
    const cache = factory(options());
    const first = cache.dispose();
    expect(cache.dispose()).toBe(first);
    await first;
    for (const method of ["get", "peek", "invalidate", "remove", "clear"] as const) {
      await expect(cache[method]("q")).rejects.toThrow("disposed");
    }
    await cache.dispose();
  });

  it("has no cross-instance invalidation guarantee", async () => {
    const opts = options();
    const a = factory(opts);
    const b = factory(opts);
    await a.get("q");
    await b.get("q");
    await a.clear();
    expect(await a.peek("q")).toBeUndefined();
    expect(await b.get("q")).toBe("one");
    expect(opts.load).toHaveBeenCalledTimes(1);
    await b.get("q", { revalidate: true });
    expect(await factory(opts).peek("q")).toMatchObject({ data: "one" });
  });

  it.each([
    "invalidate",
    "remove",
    "clear",
  ] as const)("successful %s allows reuse of another instance's subsequent validation", async (method) => {
    const opts = options();
    const a = factory(opts);
    await a.get("q");
    await a[method]("q");
    const b = factory(opts);
    vi.mocked(opts.load).mockResolvedValueOnce(modified("replacement"));
    await b.get("q", { revalidate: true });
    expect(await a.get("q")).toBe("replacement");
    expect(opts.load).toHaveBeenCalledTimes(2);
  });
});

describe("factory validation", () => {
  it.each(["", " ", null, 1])("rejects invalid namespace %s", (namespace) => {
    expect(() => createPersistentCache(options({ namespace: namespace as string }))).toThrow(TypeError);
  });
  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid schemaVersion %s", (schemaVersion) => {
    expect(() => createPersistentCache(options({ schemaVersion }))).toThrow(TypeError);
  });
  it.each([-1, NaN, Infinity])("rejects invalid maxAge %s", (maxAge) => {
    expect(() => createPersistentCache(options({ maxAge }))).toThrow(TypeError);
  });
  it.each(["key", "decode", "load"] as const)("requires a %s function", (name) => {
    expect(() => createPersistentCache(options({ [name]: null }))).toThrow(TypeError);
  });
  it.each(["", " ", null, 1])("rejects invalid sessionId %s", (sessionId) => {
    expect(() => createSessionCache({ ...options(), sessionId: sessionId as string })).toThrow(TypeError);
  });
  it("rejects a nonstring generated identity as a rejected operation", async () => {
    const cache = createPersistentCache(options({ key: (() => 1) as unknown as (q: string) => string }));
    await expect(cache.get("q")).rejects.toThrow("key must return a string");
  });
});
