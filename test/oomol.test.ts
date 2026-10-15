import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActionsQuery,
  type ActionsResponse,
  type AppCatalogResponse,
  type AppMarketingCacheOptions,
  type AppMarketingQuery,
  type AppMarketingResponse,
  type ConnectionsCacheOptions,
  type ConnectionsQuery,
  type ConnectionsResponse,
  getActionsCache,
  getAppCatalogCache,
  getAppMarketingCache,
  getConnectionsCache,
  getProvidersCache,
  type ProvidersCacheOptions,
  type ProvidersResponse,
} from "../src/oomol";
import { MemoryStorage, modified } from "./helpers";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.spyOn(Date, "now").mockReturnValue(1_000);
});
afterEach(async () => {
  const registry = Reflect.get(globalThis, Symbol.for("oomol-lab.resource-cache.oomol-singletons"));
  if (registry instanceof Map) await Promise.all([...registry.values()].map((cache) => cache.dispose()));
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

const connections: ConnectionsResponse = {
  success: true,
  message: "Connections",
  data: [
    {
      id: "gmail-1",
      service: "gmail",
      providerAccountId: "account-1",
      accountLabel: "Work",
      alias: "work",
      aliasNormalized: "work",
      comment: null,
      scopes: ["mail.read"],
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      userId: "user-1",
      createdByUserId: "user-1",
      ownerType: "team",
      ownerTeamId: "team-1",
      authType: "oauth2",
      providerScopes: ["mail.read"],
      displayName: "Gmail / Work",
      isDefault: true,
      credentialFields: [{ key: "account", label: "Account", displayValue: "work@example.com", secret: false }],
      credentialSummary: {
        authType: "api_key",
        fields: { apiKey: { configured: true, maskedValue: "••••" } },
      },
      triggerCallbackUrls: [{ service: "gmail", deliveryMode: "push", url: "https://example.com/callback" }],
      marketplace: { id: "gmail", pricing: "free" },
    },
  ],
  meta: {
    summary: {
      providerCount: 1,
      connectableProviderCount: 1,
      connectedProviderCount: 1,
      activeConnectedProviderCount: 1,
      connectedAppCount: 1,
      activeConnectedAppCount: 1,
      filteredAppCount: 1,
    },
  },
};

const marketing: AppMarketingResponse = {
  success: true,
  message: "",
  data: {
    service: "gmail",
    displayName: "Gmail",
    searchAliases: ["mail"],
    iconUrl: null,
    homepageUrl: null,
    categories: [{ id: "email", displayName: "Email" }],
    authTypes: ["oauth2"],
    iconSpritePosition: null,
    connectionMethods: [{ authType: "oauth2", oauthClientPolicy: "default_only" }],
    marketplace: null,
    actions: [{ id: "gmail.read", name: "read", displayName: "Read", description: "Read mail" }],
    triggers: [{ id: "gmail.received", name: "received", description: "New mail", deliveryMode: "poll" }],
    content: {
      title: "Gmail",
      description: "Email automation",
      headline: "Automate email",
      intro: "Connect your inbox",
      overview: "Read and organize mail",
      setup: { summary: "Connect Gmail", requirements: ["Gmail account"], notes: [] },
      useCases: [
        {
          id: "summarize",
          title: "Summarize mail",
          description: "Summarize unread mail",
          prompt: "Summarize my mail",
          requirements: [{ service: "gmail", actionIds: ["gmail.read"], triggerIds: [] }],
        },
      ],
      capabilityGroups: [{ id: "read", title: "Read", description: "Read mail", actionIds: ["gmail.read"] }],
      faq: [{ id: "access", question: "What is required?", answer: "A Gmail account" }],
      relatedServices: ["calendar"],
      landing: {
        taskSummary: "Summarize mail",
        definition: "Email automation",
        about: "Gmail",
        heroCaption: "Your inbox",
        demo: {
          useCaseId: "summarize",
          request: "Summarize my mail",
          reply: "Here is your summary",
          result: {
            label: "Inbox",
            title: "Summary",
            summary: "One message",
            items: [{ id: "mail", label: "Mail", text: "Hello" }],
          },
          steps: [{ id: "read", title: "Read", description: "Read unread mail" }],
        },
        relatedUseCaseIds: ["summarize"],
      },
    },
  },
  meta: { locale: "zh-CN", contentLocale: "en", availableContentLocales: ["en"] },
};

function options<T>(data: T) {
  return {
    environment: "production",
    locale: "zh-CN",
    schemaVersion: 1,
    maxAge: 100,
    decode: vi.fn((value) => value as T),
    load: vi.fn(async (_query: { locale: string }, _validation: unknown) => modified(data)),
  };
}

function connectionOptions(overrides: Partial<ConnectionsCacheOptions> = {}) {
  return {
    environment: "production",
    sessionId: "session-a",
    ownerId: "owner/a",
    schemaVersion: 1,
    maxAge: 100,
    decode: vi.fn((value) => value as ConnectionsResponse),
    load: vi.fn(async (_query: ConnectionsQuery, _validation: unknown) => modified(connections)),
    ...overrides,
  };
}

describe("OOMOL cache factories", () => {
  it("persists complete marketing responses and revalidates expired data with its ETag", async () => {
    const opts = options(marketing);
    const cache = getAppMarketingCache(opts);
    const [first, concurrent] = await Promise.all([cache.get("gmail"), cache.get("gmail")]);
    expect(first).toEqual(marketing);
    expect(concurrent).toBe(first);
    expect(await cache.get("gmail")).toBe(first);
    expect(opts.load).toHaveBeenCalledTimes(1);
    expect(opts.load).toHaveBeenCalledWith(
      { locale: "zh-CN", service: "gmail" },
      { etag: null, signal: expect.any(AbortSignal) },
    );
    await cache.dispose();
    const restored = getAppMarketingCache(opts);
    expect(restored).not.toBe(cache);
    expect(await restored.get("gmail")).toEqual(marketing);
    expect(opts.decode).toHaveBeenCalledWith(marketing);
    expect(opts.load).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, "now").mockReturnValue(1_100);
    opts.load.mockResolvedValueOnce({ modified: false });
    expect(await restored.get("gmail")).toEqual(marketing);
    expect(opts.load).toHaveBeenLastCalledWith(
      { locale: "zh-CN", service: "gmail" },
      { etag: '"v1"', signal: expect.any(AbortSignal) },
    );
    expect(await restored.peek("gmail")).toMatchObject({ fresh: true, validatedAt: 1_100 });
  });

  it("isolates marketing services, locales, environments, schemas and other resources", async () => {
    const load = vi.fn(async ({ service }: AppMarketingQuery) =>
      modified({
        ...marketing,
        data: { ...marketing.data, service, content: null },
        meta: { ...marketing.meta, contentLocale: null, availableContentLocales: [] },
      }),
    );
    const opts = { ...options(marketing), load };
    const cache = getAppMarketingCache(opts);
    expect(getAppMarketingCache({ ...opts, environment: undefined })).toBe(cache);
    expect(await cache.get("gmail")).toMatchObject({
      data: { service: "gmail", content: null },
      meta: { contentLocale: null },
    });
    expect(await cache.peek("calendar")).toBeUndefined();
    expect(await cache.get("calendar")).toMatchObject({ data: { service: "calendar" } });
    for (const scope of [{ locale: "en" }, { environment: "staging" }, { schemaVersion: 2 }]) {
      const other = getAppMarketingCache({ ...opts, ...scope });
      expect(other).not.toBe(cache);
      expect(await other.peek("gmail")).toBeUndefined();
    }
    expect(await getAppCatalogCache(options(apps)).peek()).toBeUndefined();
    expect(await getActionsCache(options(actions)).peek("gmail")).toBeUndefined();
    await cache.get("a/b");
    await cache.dispose();
    expect(await getAppMarketingCache({ ...opts, locale: "zh-CN/a" }).peek("b")).toBeUndefined();
    const restored = getAppMarketingCache(opts);
    const loadCount = load.mock.calls.length;
    expect(await restored.get("a/b")).toMatchObject({
      data: { service: "a/b", content: null },
      meta: { contentLocale: null, availableContentLocales: [] },
    });
    expect(load).toHaveBeenCalledTimes(loadCount);
  });

  it("keys marketing language fallbacks by requested locale and captures loader configuration", async () => {
    const load = vi.fn(async (query: { locale: string; service: string }) => {
      const response = { ...marketing, message: query.locale, data: { ...marketing.data, service: query.service } };
      query.locale = "en";
      query.service = "calendar";
      return modified(response);
    });
    const opts = { ...options(marketing), load };
    const chinese = getAppMarketingCache(opts);
    opts.locale = "en";
    opts.load = vi.fn(async () =>
      modified({ ...marketing, message: "replacement", meta: { ...marketing.meta, locale: "en" } }),
    );
    const english = getAppMarketingCache(opts);

    expect(await chinese.get("gmail")).toMatchObject({ message: "zh-CN", meta: { contentLocale: "en" } });
    expect(await english.peek("gmail")).toBeUndefined();
    expect(await english.get("gmail")).toMatchObject({ message: "replacement" });
    expect(await chinese.get("gmail", { revalidate: true })).toMatchObject({
      message: "zh-CN",
      data: { service: "gmail" },
    });
    expect(await chinese.peek("calendar")).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
    expect(opts.load).toHaveBeenCalledTimes(1);

    await chinese.dispose();
    const restored = getAppMarketingCache({ ...options(marketing), load });
    expect(await restored.get("gmail")).toMatchObject({ message: "zh-CN", meta: { contentLocale: "en" } });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects failed marketing loads without persisting an error or extending freshness", async () => {
    const opts = options(marketing);
    const cache = getAppMarketingCache(opts);
    opts.load.mockRejectedValueOnce(new Error("404"));
    await expect(cache.get("gmail")).rejects.toThrow("404");
    expect(await cache.peek("gmail")).toBeUndefined();
    await cache.get("gmail");
    vi.spyOn(Date, "now").mockReturnValue(1_100);
    opts.load.mockRejectedValueOnce(new Error("500"));
    await expect(cache.get("gmail")).rejects.toThrow("500");
    expect(await cache.peek("gmail")).toMatchObject({ data: marketing, fresh: false, validatedAt: 1_000 });
  });

  it("validates marketing configuration and service queries", async () => {
    for (const field of ["locale", "environment", "load"] as const) {
      expect(() =>
        getAppMarketingCache({ ...options(marketing), [field]: null } as unknown as AppMarketingCacheOptions),
      ).toThrow(TypeError);
    }
    const cache = getAppMarketingCache(options(marketing));
    for (const service of ["", " ", null, 1]) {
      await expect(cache.get(service as string)).rejects.toThrow("service must be nonempty");
    }
  });

  it("passes locale and validators to the loader and restores the same identity", async () => {
    const opts = options(providers);
    const first = getProvidersCache(opts);
    expect(await first.get()).toEqual(providers);
    expect(opts.load).toHaveBeenCalledWith({ locale: "zh-CN" }, { etag: null, signal: expect.any(AbortSignal) });
    expect(opts.decode).not.toHaveBeenCalled();
    expect(await getProvidersCache(opts).get()).toEqual(providers);
    expect(opts.load).toHaveBeenCalledTimes(1);
    expect(opts.decode).toHaveBeenCalledTimes(0);
    vi.mocked(opts.load).mockResolvedValueOnce({ modified: false });
    expect(await first.get(undefined, { revalidate: true })).toEqual(providers);
    expect(opts.load).toHaveBeenLastCalledWith({ locale: "zh-CN" }, { etag: '"v1"', signal: expect.any(AbortSignal) });
  });

  it("isolates environment, locale and resource without string concatenation collisions", async () => {
    const opts = options(providers);
    await getProvidersCache(opts).get();
    expect(await getProvidersCache({ ...opts, environment: "staging" }).peek()).toBeUndefined();
    expect(await getProvidersCache({ ...opts, locale: "en-US" }).peek()).toBeUndefined();
    expect(await getActionsCache(options(actions)).peek("gmail")).toBeUndefined();
    const appCache = getAppCatalogCache(options(apps));
    expect(await appCache.peek()).toBeUndefined();
    expect(await appCache.get()).toEqual(apps);
    const special = getProvidersCache({ ...opts, locale: 'c"' });
    await special.get();
    expect(await getProvidersCache({ ...opts, locale: 'b","c"' }).peek()).toBeUndefined();
    expect(await getProvidersCache(opts).peek()).toMatchObject({ data: providers });
  });

  it("uses production as the default environment", async () => {
    const { environment: _environment, ...withoutEnvironment } = options(providers);
    await getProvidersCache(withoutEnvironment).get();
    expect(await getProvidersCache(options(providers)).peek()).toMatchObject({ data: providers });
  });

  it("keeps account-independent data shared when request credentials change", async () => {
    let token = "token-a";
    const load = vi.fn(async () => modified({ ...providers, message: token }));
    const cache = getProvidersCache({ ...options(providers), load });

    expect(await cache.get()).toMatchObject({ message: "token-a" });
    token = "token-b";
    expect(await cache.get(undefined, { revalidate: true })).toMatchObject({ message: "token-b" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("includes service in Actions identity and supplies it to the loader", async () => {
    const load = vi.fn(async ({ service }: ActionsQuery) => modified({ ...actions, message: service }));
    const opts = { ...options(actions), load };
    const gmail = getActionsCache(opts);
    expect(await gmail.get("gmail")).toMatchObject({ message: "gmail" });
    expect(await gmail.get("calendar")).toMatchObject({ message: "calendar" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith({ locale: "zh-CN", service: "gmail" }, expect.any(Object));
    expect(await getActionsCache(opts).get("gmail")).toMatchObject({ message: "gmail" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("captures configuration and keeps host query mutation out of later requests", async () => {
    const opts = { ...options(providers) };
    const load = vi.fn(async (query: { locale: string }, _validation: unknown) => {
      const data = { ...providers, message: query.locale };
      query.locale = "mutated by loader";
      return modified(data);
    });
    opts.load = load;
    const cache = getProvidersCache(opts);
    opts.locale = "en-US";
    opts.load = vi.fn(async () => modified({ ...providers, message: "replacement" }));
    expect(await cache.get()).toMatchObject({ message: "zh-CN" });
    expect(await cache.get(undefined, { revalidate: true })).toMatchObject({ message: "zh-CN" });
    expect(opts.load).not.toHaveBeenCalled();
    expect(await getProvidersCache(options(providers)).get()).toMatchObject({ message: "zh-CN" });
  });

  it("clear covers all locales in the resource and preserves other resources", async () => {
    const opts = options(providers);
    const primary = getProvidersCache(opts);
    await primary.get();
    const english = getProvidersCache({ ...opts, locale: "en-US" });
    await english.get();
    await getAppCatalogCache(options(apps)).get();
    await primary.clear();
    expect(await primary.peek()).toBeUndefined();
    await english.dispose();
    expect(await getProvidersCache({ ...opts, locale: "en-US" }).peek()).toBeUndefined();
    expect(await getAppCatalogCache(options(apps)).peek()).toMatchObject({ data: apps });
  });

  it.each(["environment", "locale"] as const)("rejects blank and nonstring %s synchronously", (field) => {
    for (const value of [" ", null, 1]) {
      expect(() =>
        getProvidersCache({
          ...options(providers),
          [field]: value,
        } as unknown as ProvidersCacheOptions),
      ).toThrow(TypeError);
    }
  });

  it("rejects a blank or nonstring service when it is used as a query", async () => {
    for (const service of [" ", null, 1]) {
      const cache = getActionsCache(options(actions));
      await expect(cache.get(service as string)).rejects.toThrow(TypeError);
      await expect(cache.peek(service as string)).rejects.toThrow(TypeError);
    }
  });

  it("validates the host loader before wrapping it", () => {
    expect(() => getProvidersCache({ ...options(providers), load: null } as unknown as ProvidersCacheOptions)).toThrow(
      "load must be a function",
    );
  });

  it("shares keyed OOMOL instances and removes them after disposal", async () => {
    const opts = options(providers);
    const first = getProvidersCache(opts);
    const second = getProvidersCache({ ...opts });
    expect(second).toBe(first);
    expect(getProvidersCache({ ...opts, environment: "staging" })).not.toBe(first);
    expect(await first.get()).toEqual(providers);
    await first.dispose();
    await expect(first.get()).rejects.toThrow("disposed");

    const replacement = getProvidersCache(opts);
    expect(replacement).not.toBe(first);
    expect(await replacement.get()).toEqual(providers);
    await replacement.dispose();
    await getProvidersCache({ ...opts, environment: "staging" }).dispose();
  });

  it("keeps repeated singleton disposal idempotent", async () => {
    const opts = options(providers);
    const cache = getProvidersCache(opts);
    expect(getProvidersCache({ ...opts })).toBe(cache);
    await cache.dispose();
    await cache.dispose();
  });

  it("keeps the singleton registry across module copies in one runtime", async () => {
    const opts = options(providers);
    const first = getProvidersCache(opts);
    const registry = Reflect.get(globalThis, Symbol.for("oomol-lab.resource-cache.oomol-singletons"));
    expect(registry).toBeInstanceOf(Map);

    vi.resetModules();
    const copy = await import("../src/oomol");
    expect(copy.getProvidersCache(opts)).toBe(first);
    await first.dispose();
  });

  it("shares one singleton across Actions services and isolates App Catalog identity", async () => {
    const actionsOptions = options(actions);
    const gmail = getActionsCache(actionsOptions);
    expect(getActionsCache({ ...actionsOptions })).toBe(gmail);
    expect(await gmail.get("gmail")).toEqual(actions);
    expect(await gmail.get("calendar")).toEqual(actions);

    const appOptions = options(apps);
    expect(getAppCatalogCache(appOptions)).toBe(getAppCatalogCache({ ...appOptions }));
    await gmail.dispose();
    await getAppCatalogCache(appOptions).dispose();
  });

  it("caches Connections in sessionStorage and revalidates with its ETag", async () => {
    const opts = connectionOptions();
    const cache = getConnectionsCache(opts);

    expect(await cache.get()).toEqual(connections);
    expect(opts.load).toHaveBeenCalledWith({ ownerId: "owner/a" }, { etag: null, signal: expect.any(AbortSignal) });
    expect(opts.decode).not.toHaveBeenCalled();
    expect(await getConnectionsCache(opts).get()).toEqual(connections);
    expect(opts.load).toHaveBeenCalledTimes(1);

    vi.mocked(opts.load).mockResolvedValueOnce({ modified: false });
    expect(await cache.get(undefined, { revalidate: true })).toEqual(connections);
    expect(opts.load).toHaveBeenLastCalledWith(
      { ownerId: "owner/a" },
      { etag: '"v1"', signal: expect.any(AbortSignal) },
    );
    expect(await cache.peek()).toMatchObject({ data: connections, etag: '"v1"' });
  });

  it("isolates Connections by session, team, environment and schema", async () => {
    const opts = connectionOptions();
    const team = getConnectionsCache(opts);
    expect(getConnectionsCache({ ...opts })).toBe(team);
    expect(getConnectionsCache({ ...opts, ownerId: "owner/b" })).not.toBe(team);
    expect(getConnectionsCache({ ...opts, sessionId: "session-b" })).not.toBe(team);
    expect(getConnectionsCache({ ...opts, environment: "staging" })).not.toBe(team);
    expect(getConnectionsCache({ ...opts, schemaVersion: 2 })).not.toBe(team);

    await team.get();
    expect(await getConnectionsCache({ ...opts, ownerId: "owner/b" }).peek()).toBeUndefined();
    expect(await getConnectionsCache({ ...opts, sessionId: "session-b" }).peek()).toBeUndefined();
    expect(await getConnectionsCache({ ...opts, environment: "staging" }).peek()).toBeUndefined();
    expect(await getConnectionsCache({ ...opts, schemaVersion: 2 }).peek()).toBeUndefined();
  });

  it("disposes every owner scope for one session without touching another session", async () => {
    const firstOwner = getConnectionsCache({ ...connectionOptions(), ownerId: "owner/b" });
    const team = getConnectionsCache(connectionOptions());
    const otherSession = getConnectionsCache({ ...connectionOptions(), sessionId: "session-b" });
    await firstOwner.get();
    await team.get();
    await otherSession.get();

    const storage = globalThis.sessionStorage as MemoryStorage;
    expect(storage.length).toBe(3);
    await team.dispose();
    expect(storage.length).toBe(1);
    expect(storage.values.keys().next().value).toContain('"session-b"');
  });

  it("rejects invalid Connections session and owner options", () => {
    const opts = connectionOptions();
    expect(() => getConnectionsCache({ ...opts, sessionId: " " })).toThrow("sessionId must be nonempty");
    expect(() => getConnectionsCache({ ...opts, sessionId: null } as unknown as ConnectionsCacheOptions)).toThrow(
      "sessionId must be nonempty",
    );
    expect(() => getConnectionsCache({ ...opts, ownerId: " " })).toThrow("ownerId must be nonempty");
    expect(() => getConnectionsCache({ ...opts, ownerId: 1 } as unknown as ConnectionsCacheOptions)).toThrow(
      "ownerId must be nonempty",
    );
    expect(() => getConnectionsCache({ ...opts, load: null } as unknown as ConnectionsCacheOptions)).toThrow(
      "load must be a function",
    );
  });

  it("retries singleton disposal after sessionStorage cleanup fails", async () => {
    const failingStorage = new MemoryStorage();
    failingStorage.removeItem = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("sessionStorage", failingStorage);
    const cache = getConnectionsCache(connectionOptions());
    await cache.get();
    await expect(cache.dispose()).rejects.toThrow("denied");

    vi.stubGlobal("sessionStorage", new MemoryStorage());
    await cache.dispose();
  });
});
