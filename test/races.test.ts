import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCache } from "../src/cache";
import type { StorageBackend, Stored } from "../src/storage";
import { deferred, modified, options, until } from "./helpers";

const stored: Stored = {
  meta: { version: "original", etag: '"v1"', validatedAt: 1_000, invalidated: false },
  body: { data: "stored" },
};

function backend(): StorageBackend {
  const records = new Map(["q", "a", "b", "other", "unloaded"].map((key) => [key, stored]));
  return {
    read: vi.fn(async (key) => records.get(key)),
    write: vi.fn(async (key, entry) => {
      const { data, ...meta } = entry;
      records.set(key, { meta, body: { data } });
      return true;
    }),
    invalidate: vi.fn(async (key) => {
      const value = records.get(key);
      if (!value) return undefined;
      const invalidated = { ...value, meta: { ...value.meta, invalidated: true } };
      records.set(key, invalidated);
      return invalidated;
    }),
    remove: vi.fn(async (key) => {
      records.delete(key);
    }),
    clear: vi.fn(async () => {
      records.clear();
    }),
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1_000);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("lifecycle races with storage", () => {
  it.each(["invalidate", "remove", "clear"] as const)(
    "%s publishes the new lifetime before host abort listeners retry",
    async (method) => {
      const disk = backend();
      vi.mocked(disk.read).mockResolvedValue(undefined);
      const pending = deferred<ReturnType<typeof modified<string>>>();
      const opts = options({
        load: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(modified("current")),
      });
      const cache = createCache(opts, disk, false);
      const old = expect(cache.get("q")).rejects.toMatchObject({ name: "AbortError" });
      await until(() => vi.mocked(opts.load).mock.calls.length === 1);
      let retry!: Promise<void>;
      vi.mocked(opts.load).mock.calls[0][1].signal.addEventListener("abort", () => {
        retry = expect(cache.get("q")).resolves.toBe("current");
      });

      await cache[method]("q");
      pending.resolve(modified("late"));
      await old;
      await retry;
      expect(opts.load).toHaveBeenCalledTimes(2);
      expect(vi.mocked(opts.load).mock.calls[1][1].signal.aborted).toBe(false);
      expect(disk.write).toHaveBeenCalledTimes(1);
      expect(await cache.peek("q")).toMatchObject({ data: "current", fresh: true });
    },
  );

  it("clear cancels only existing lifetimes when an abort listener requests a new key", async () => {
    const disk = backend();
    vi.mocked(disk.read).mockResolvedValue(undefined);
    const pending = deferred<ReturnType<typeof modified<string>>>();
    const opts = options({ load: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(modified("new key")) });
    const cache = createCache(opts, disk, false);
    const old = expect(cache.get("q")).rejects.toMatchObject({ name: "AbortError" });
    await until(() => vi.mocked(opts.load).mock.calls.length === 1);
    let next!: Promise<void>;
    vi.mocked(opts.load).mock.calls[0][1].signal.addEventListener("abort", () => {
      next = expect(cache.get("created during abort")).resolves.toBe("new key");
    });

    await cache.clear();
    pending.resolve(modified("late"));
    await old;
    await next;
    expect(opts.load).toHaveBeenCalledTimes(2);
    expect(await cache.peek("q")).toBeUndefined();
    expect(await cache.peek("created during abort")).toMatchObject({ data: "new key", fresh: true });
  });

  it("dispose is idempotent even when a host abort listener calls dispose again", async () => {
    const disk = backend();
    const pending = deferred<ReturnType<typeof modified<string>>>();
    const opts = options({ maxAge: 0, load: vi.fn(() => pending.promise) });
    const cache = createCache(opts, disk, true);
    const old = expect(cache.get("q")).rejects.toMatchObject({ name: "AbortError" });
    await until(() => vi.mocked(opts.load).mock.calls.length === 1);
    let repeated!: Promise<void>;
    vi.mocked(opts.load).mock.calls[0][1].signal.addEventListener("abort", () => {
      repeated = cache.dispose();
    });

    const disposal = cache.dispose();
    expect(repeated).toBe(disposal);
    await disposal;
    pending.resolve(modified("late"));
    await old;
    expect(disk.clear).toHaveBeenCalledExactlyOnceWith(true);
    expect(disk.write).not.toHaveBeenCalled();
  });

  it("an earlier successful clear cannot lift a newer failed clear's barrier", async () => {
    const disk = backend();
    const pending = deferred<void>();
    vi.mocked(disk.clear).mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("second denied"));
    const cache = createCache(options(), disk, false);
    const first = cache.clear();
    await until(() => vi.mocked(disk.clear).mock.calls.length === 1);
    const second = expect(cache.clear()).rejects.toThrow("second denied");
    const peek = cache.peek("q");
    pending.resolve();
    await first;
    await second;
    expect(await peek).toBeUndefined();
    expect(disk.read).not.toHaveBeenCalled();
  });

  it("successful clear releases inherited barriers but preserves later failed per-key removal", async () => {
    const disk = backend();
    const pending = deferred<void>();
    vi.mocked(disk.clear).mockReturnValueOnce(pending.promise);
    vi.mocked(disk.remove).mockRejectedValueOnce(new Error("remove denied"));
    const cache = createCache(options(), disk, false);
    const clear = cache.clear();
    await until(() => vi.mocked(disk.clear).mock.calls.length === 1);
    const inherited = cache.peek("other");
    const removal = expect(cache.remove("q")).rejects.toThrow("remove denied");
    const removed = cache.peek("q");
    pending.resolve();
    await clear;
    expect(await inherited).toMatchObject({ data: "stored" });
    await removal;
    expect(await removed).toBeUndefined();
    expect(disk.read).toHaveBeenCalledTimes(1);
  });

  it.each(["remove", "clear"] as const)("invalidate cannot bypass a failed %s barrier", async (method) => {
    const disk = backend();
    vi.mocked(disk[method]).mockRejectedValue(new Error("delete denied"));
    const opts = options();
    const cache = createCache(opts, disk, false);
    await expect(cache[method]("q")).rejects.toThrow("delete denied");
    await cache.invalidate("q");
    expect(await cache.peek("q")).toBeUndefined();
    expect(await cache.get("q")).toBe("one");
    expect(opts.load).toHaveBeenCalledWith("q", { etag: null, signal: expect.any(AbortSignal) });
  });

  it("a peek canceled during an actual storage read cannot repopulate memory", async () => {
    const disk = backend();
    const pending = deferred<Stored | undefined>();
    vi.mocked(disk.read).mockReturnValueOnce(pending.promise);
    const cache = createCache(options(), disk, false);
    const peek = expect(cache.peek("q")).rejects.toMatchObject({ name: "AbortError" });
    await until(() => vi.mocked(disk.read).mock.calls.length === 1);
    const clearing = cache.clear();
    await peek;
    pending.resolve(stored);
    await clearing;
    expect(await cache.peek("q")).toBeUndefined();
    expect(disk.write).not.toHaveBeenCalled();
  });

  it("clear cancels a get during lookup before it can invoke load", async () => {
    const disk = backend();
    const pending = deferred<Stored | undefined>();
    vi.mocked(disk.read).mockReturnValueOnce(pending.promise);
    const opts = options({ maxAge: 0 });
    const cache = createCache(opts, disk, false);
    const get = expect(cache.get("q")).rejects.toMatchObject({ name: "AbortError" });
    await until(() => vi.mocked(disk.read).mock.calls.length === 1);
    const clear = cache.clear();
    await get;
    pending.resolve(stored);
    await clear;
    expect(opts.load).not.toHaveBeenCalled();
    expect(await cache.peek("q")).toBeUndefined();
  });

  it("a queued read invalidated before its turn cannot fetch or restore storage", async () => {
    const disk = backend();
    const pending = deferred<Stored | undefined>();
    vi.mocked(disk.read).mockReturnValueOnce(pending.promise);
    const cache = createCache(options(), disk, false);
    const first = cache.peek("a");
    await until(() => vi.mocked(disk.read).mock.calls.length === 1);
    const second = expect(cache.peek("b")).rejects.toMatchObject({ name: "AbortError" });
    const remove = cache.remove("b");
    await second;
    pending.resolve(stored);
    await first;
    await remove;
    expect(disk.read).toHaveBeenCalledTimes(1);
    expect(await cache.peek("b")).toBeUndefined();
  });

  it("removal is ordered after a write already submitted and never exposes its result", async () => {
    const disk = backend();
    const write = deferred<boolean>();
    vi.mocked(disk.read).mockResolvedValue(undefined);
    vi.mocked(disk.write).mockReturnValueOnce(write.promise);
    const cache = createCache(options(), disk, false);
    const get = expect(cache.get("q")).rejects.toMatchObject({ name: "AbortError" });
    await until(() => vi.mocked(disk.write).mock.calls.length === 1);
    const remove = cache.remove("q");
    await get;
    expect(disk.remove).not.toHaveBeenCalled();
    write.resolve(true);
    await remove;
    expect(disk.remove).toHaveBeenCalledTimes(1);
    expect(await cache.peek("q")).toBeUndefined();
  });

  it("a successful network response waiting to write is canceled before storage submission", async () => {
    const disk = backend();
    vi.mocked(disk.read).mockResolvedValue(undefined);
    const response = deferred<ReturnType<typeof modified<string>>>();
    const opts = options({ load: vi.fn(() => response.promise) });
    const cache = createCache(opts, disk, false);
    const get = expect(cache.get("q")).rejects.toMatchObject({ name: "AbortError" });
    await until(() => vi.mocked(opts.load).mock.calls.length === 1);
    const diskRead = deferred<Stored | undefined>();
    vi.mocked(disk.read).mockReturnValueOnce(diskRead.promise);
    const otherPeek = cache.peek("other");
    await until(() => vi.mocked(disk.read).mock.calls.length === 2);
    response.resolve(modified("network"));
    await Promise.resolve();
    const remove = cache.remove("q");
    await get;
    diskRead.resolve(undefined);
    await otherPeek;
    await remove;
    expect(disk.write).not.toHaveBeenCalled();
    expect(await cache.peek("q")).toBeUndefined();
  });

  it("clear shields unloaded keys after deletion and subsequent persistence both fail", async () => {
    const disk = backend();
    vi.mocked(disk.clear).mockRejectedValue(new Error("delete denied"));
    vi.mocked(disk.write).mockRejectedValue(new Error("write denied"));
    const opts = options();
    const cache = createCache(opts, disk, false);
    await expect(cache.clear()).rejects.toThrow("delete denied");
    expect(await cache.peek("unloaded")).toBeUndefined();
    expect(await cache.get("unloaded")).toBe("one");
    vi.mocked(Date.now).mockReturnValue(900);
    // Stored data would now be fresh; the failed-cleanup barrier must survive.
    expect(await cache.peek("unloaded")).toMatchObject({ data: "one", fresh: false });
    expect(disk.read).not.toHaveBeenCalled();
    await cache.get("unloaded");
    expect(opts.load).toHaveBeenCalledTimes(2);
    vi.mocked(disk.write).mockResolvedValue(true);
    await cache.get("unloaded", { revalidate: true });
    vi.mocked(Date.now).mockReturnValue(1_000);
    expect(await cache.peek("unloaded")).toMatchObject({ data: "stored" });
    expect(disk.read).toHaveBeenCalledTimes(1);
  });

  it("late invalidate storage completion cannot fill a state removed during the operation", async () => {
    const disk = backend();
    const pending = deferred<Stored | undefined>();
    vi.mocked(disk.invalidate).mockReturnValueOnce(pending.promise);
    const cache = createCache(options(), disk, false);
    const invalidate = cache.invalidate("q");
    await until(() => vi.mocked(disk.invalidate).mock.calls.length === 1);
    const remove = cache.remove("q");
    pending.resolve(stored);
    await invalidate;
    await remove;
    expect(await cache.peek("q")).toBeUndefined();
  });

  it("invalidate retains the in-memory response when its previous persistence failed", async () => {
    const disk = backend();
    vi.mocked(disk.write).mockRejectedValue(new Error("quota"));
    const opts = options({ load: vi.fn(async () => modified("newest")) });
    const cache = createCache(opts, disk, false);
    expect(await cache.get("q", { revalidate: true })).toBe("newest");
    await cache.invalidate("q");
    expect(await cache.peek("q")).toMatchObject({ data: "newest", fresh: false });
  });

  it("a force arriving during the next round starts a third validation", async () => {
    const disk = backend();
    vi.mocked(disk.read).mockResolvedValue(undefined);
    const second = deferred<ReturnType<typeof modified<string>>>();
    const opts = options({
      load: vi
        .fn()
        .mockResolvedValueOnce(modified("first"))
        .mockReturnValueOnce(second.promise)
        .mockResolvedValueOnce(modified("third")),
    });
    const cache = createCache(opts, disk, false);
    await cache.get("q");
    const forceA = cache.get("q", { revalidate: true });
    await until(() => vi.mocked(opts.load).mock.calls.length === 2);
    const forceB = cache.get("q", { revalidate: true });
    second.resolve(modified("second"));
    expect(await forceA).toBe("second");
    expect(await forceB).toBe("third");
    expect(opts.load).toHaveBeenCalledTimes(3);
  });

  it("a caller abort during lookup releases only that wait; shared work can populate the cache", async () => {
    const disk = backend();
    const pending = deferred<Stored | undefined>();
    vi.mocked(disk.read).mockReturnValueOnce(pending.promise);
    const cache = createCache(options(), disk, false);
    const controller = new AbortController();
    const get = expect(cache.get("q", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await until(() => vi.mocked(disk.read).mock.calls.length === 1);
    controller.abort();
    await get;
    const other = cache.get("q");
    pending.resolve(stored);
    expect(await other).toBe("stored");
  });

  it("a caller's listener is removed after an ordinary load failure", async () => {
    const disk = backend();
    vi.mocked(disk.read).mockResolvedValue(undefined);
    const opts = options({
      load: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const cache = createCache(opts, disk, false);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(cache.get("q", { signal: controller.signal })).rejects.toThrow("offline");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
