import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActionsQuery,
  type ActionsResponse,
  type AppCatalogResponse,
  createActionsCache,
  createAppCatalogCache,
  createProvidersCache,
  getActionsCache,
  getAppCatalogCache,
  getProvidersCache,
  type OomolCacheOptions,
  type ProvidersResponse,
} from "../src/oomol";
import { modified } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.spyOn(Date, "now").mockReturnValue(1_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const providers: ProvidersResponse = {
  success: true,
  message: "Providers",
  data: [],
  meta: { totalCount: 0, iconSprite: null },
};
const actions: ActionsResponse = { success: true, message: "Actions", data: [] };
const apps: AppCatalogResponse = {
  success: true,
  message: "Apps",
  data: [],
  meta: {
    summary: {
      providerCount: 0,
      actionCount: 0,
      categoryCount: 0,
      oauthProviderCount: 0,
      apiKeyProviderCount: 0,
      healthyProviderCount: null,
    },
    categories: [],
    authTypes: [],
    iconSprite: null,
  },
};

function options<T>(data: T): OomolCacheOptions<T> {
  return {
    scope: "production",
    locale: "zh-CN",
    schemaVersion: 1,
    maxAge: 100,
    decode: vi.fn((value) => value as T),
    load: vi.fn(async () => modified(data)),
  };
}

describe("OOMOL cache factories", () => {
  it("passes locale and validators to the loader and restores the same identity", async () => {
    const opts = options(providers);
    const first = createProvidersCache(opts);
    expect(await first.get()).toEqual(providers);
    expect(opts.load).toHaveBeenCalledWith({ locale: "zh-CN" }, { etag: null, signal: expect.any(AbortSignal) });
    expect(opts.decode).not.toHaveBeenCalled();
    expect(await createProvidersCache(opts).get()).toEqual(providers);
    expect(opts.load).toHaveBeenCalledTimes(1);
    expect(opts.decode).toHaveBeenCalledTimes(1);
    vi.mocked(opts.load).mockResolvedValueOnce({ modified: false });
    expect(await first.get(undefined, { revalidate: true })).toEqual(providers);
    expect(opts.load).toHaveBeenLastCalledWith({ locale: "zh-CN" }, { etag: '"v1"', signal: expect.any(AbortSignal) });
  });

  it("isolates locale, environment and resource without string concatenation collisions", async () => {
    const opts = options(providers);
    await createProvidersCache(opts).get();
    expect(await createProvidersCache({ ...opts, locale: "en-US" }).peek()).toBeUndefined();
    expect(await createProvidersCache({ ...opts, scope: "staging" }).peek()).toBeUndefined();
    expect(await createActionsCache(options(actions)).peek("gmail")).toBeUndefined();
    const appCache = createAppCatalogCache(options(apps));
    expect(await appCache.peek()).toBeUndefined();
    expect(await appCache.get()).toEqual(apps);
    const special = createProvidersCache({ ...opts, scope: 'a","b', locale: 'c"' });
    await special.get();
    expect(await createProvidersCache({ ...opts, scope: "a", locale: 'b","c"' }).peek()).toBeUndefined();
    expect(await createProvidersCache(opts).peek()).toMatchObject({ data: providers });
  });

  it("includes service in Actions identity and supplies it to the loader", async () => {
    const load = vi.fn(async ({ service }: ActionsQuery) => modified({ ...actions, message: service }));
    const opts = { ...options(actions), load };
    const gmail = createActionsCache(opts);
    expect(await gmail.get("gmail")).toMatchObject({ message: "gmail" });
    expect(await gmail.get("calendar")).toMatchObject({ message: "calendar" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith({ locale: "zh-CN", service: "gmail" }, expect.any(Object));
    expect(await createActionsCache(opts).get("gmail")).toMatchObject({ message: "gmail" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("captures configuration and keeps host query mutation out of later requests", async () => {
    const opts = { ...options(providers) };
    const load = vi.fn(async (query: { locale: string }) => {
      const data = { ...providers, message: query.locale };
      query.locale = "mutated by loader";
      return modified(data);
    });
    opts.load = load;
    const cache = createProvidersCache(opts);
    opts.scope = "changed";
    opts.locale = "en-US";
    opts.load = vi.fn(async () => modified({ ...providers, message: "replacement" }));
    expect(await cache.get()).toMatchObject({ message: "zh-CN" });
    expect(await cache.get(undefined, { revalidate: true })).toMatchObject({ message: "zh-CN" });
    expect(opts.load).not.toHaveBeenCalled();
    expect(await createProvidersCache(options(providers)).get()).toMatchObject({ message: "zh-CN" });
  });

  it("clear covers all locales in the resource scope and preserves other scopes and resources", async () => {
    const opts = options(providers);
    const primary = createProvidersCache(opts);
    await primary.get();
    await createProvidersCache({ ...opts, locale: "en-US" }).get();
    await createProvidersCache({ ...opts, scope: "staging" }).get();
    await createAppCatalogCache(options(apps)).get();
    await primary.clear();
    expect(await primary.peek()).toBeUndefined();
    expect(await createProvidersCache({ ...opts, locale: "en-US" }).peek()).toBeUndefined();
    expect(await createProvidersCache({ ...opts, scope: "staging" }).peek()).toMatchObject({ data: providers });
    expect(await createAppCatalogCache(options(apps)).peek()).toMatchObject({ data: apps });
  });

  it.each(["scope", "locale"] as const)("rejects blank and nonstring %s synchronously", (field) => {
    for (const value of [" ", null, 1]) {
      expect(() =>
        createProvidersCache({
          ...options(providers),
          [field]: value,
        } as unknown as OomolCacheOptions<ProvidersResponse>),
      ).toThrow(TypeError);
    }
  });

  it("rejects a blank or nonstring service when it is used as a query", async () => {
    for (const service of [" ", null, 1]) {
      const cache = createActionsCache(options(actions));
      await expect(cache.get(service as string)).rejects.toThrow(TypeError);
      await expect(cache.peek(service as string)).rejects.toThrow(TypeError);
    }
  });

  it("validates the host loader before wrapping it", () => {
    expect(() =>
      createProvidersCache({ ...options(providers), load: null } as unknown as OomolCacheOptions<ProvidersResponse>),
    ).toThrow("load must be a function");
  });

  it("uses the default scope when none is supplied", async () => {
    const { scope: _scope, ...opts } = options(providers);
    expect(await createProvidersCache(opts).get()).toEqual(providers);
  });

  it("shares keyed OOMOL instances and removes them after disposal", async () => {
    const opts = { ...options(providers), scope: "singleton-test" };
    const first = getProvidersCache(opts);
    const second = getProvidersCache({ ...opts });
    expect(second).toBe(first);
    expect(await first.get()).toEqual(providers);
    await first.dispose();
    await expect(first.get()).rejects.toThrow("disposed");

    const replacement = getProvidersCache(opts);
    expect(replacement).not.toBe(first);
    expect(await replacement.get()).toEqual(providers);
    await replacement.dispose();
  });

  it("uses the default singleton scope and keeps repeated disposal idempotent", async () => {
    const { scope: _scope, ...opts } = options(providers);
    const cache = getProvidersCache(opts);
    expect(getProvidersCache({ ...opts })).toBe(cache);
    await cache.dispose();
    await cache.dispose();
  });

  it("keeps the singleton registry across module copies in one runtime", async () => {
    const opts = { ...options(providers), scope: "global-registry" };
    const first = getProvidersCache(opts);
    const registry = Reflect.get(globalThis, Symbol.for("oomol-lab.resource-cache.oomol-singletons"));
    expect(registry).toBeInstanceOf(Map);

    vi.resetModules();
    const copy = await import("../src/oomol");
    expect(copy.getProvidersCache(opts)).toBe(first);
    await first.dispose();
  });

  it("shares one singleton across Actions services and isolates App Catalog identity", async () => {
    const actionsOptions = { ...options(actions), scope: "singleton-services" };
    const gmail = getActionsCache(actionsOptions);
    expect(getActionsCache({ ...actionsOptions })).toBe(gmail);
    expect(await gmail.get("gmail")).toEqual(actions);
    expect(await gmail.get("calendar")).toEqual(actions);

    const appOptions = { ...options(apps), scope: "singleton-apps" };
    expect(getAppCatalogCache(appOptions)).toBe(getAppCatalogCache({ ...appOptions }));
    await gmail.dispose();
    await getAppCatalogCache(appOptions).dispose();
  });
});
