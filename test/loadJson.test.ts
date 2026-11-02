import { afterEach, expect, it, vi } from "vitest";
import { loadJson } from "../src/index";

afterEach(() => vi.unstubAllGlobals());
const validation = (etag: string | null = null) => ({ etag, signal: new AbortController().signal });
const decode = (value: unknown) => value;

it("loads complete JSON using the supplied decoder, URL and request policy", async () => {
  const url = new URL("https://example.com/items?locale=en");
  const data = { items: ["one"], extra: { preserved: true } };
  const fetcher = vi.fn().mockResolvedValue(Response.json(data, { headers: { ETag: '"v2"' } }));
  vi.stubGlobal("fetch", fetcher);
  const decoder = vi.fn(decode);
  const request = validation('"v1"');
  expect(
    await loadJson(url, request, decoder, { credentials: "omit", headers: { Accept: "application/json" } }),
  ).toEqual({
    modified: true,
    data,
    etag: '"v2"',
  });
  const [input, init] = fetcher.mock.calls[0];
  expect(input).toBe(url);
  expect(init).toMatchObject({ method: "GET", credentials: "omit", signal: request.signal });
  expect(init.headers.get("Accept")).toBe("application/json");
  expect(init.headers.get("If-None-Match")).toBe('"v1"');
  expect(decoder).toHaveBeenCalledWith(data);
});

it("keeps credential policy unset by default and reports a missing ETag as null", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([1, 2]));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadJson("/items", validation(), decode)).toEqual({ modified: true, data: [1, 2], etag: null });
  const init = fetcher.mock.calls[0][1];
  expect(init.credentials).toBeUndefined();
  expect(init.headers.has("If-None-Match")).toBe(false);
});

it("uses only the cache validator, overriding an unrelated request header", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  await loadJson("/items", validation(), decode, { headers: { "If-None-Match": '"unrelated"' } });
  expect(fetcher.mock.calls[0][1].headers.has("If-None-Match")).toBe(false);
  await loadJson("/items", validation('"cache"'), decode, { headers: { "If-None-Match": '"unrelated"' } });
  expect(fetcher.mock.calls[1][1].headers.get("If-None-Match")).toBe('"cache"');
});

it.each([undefined, '"replacement"'])("preserves optional 304 validators without decoding (%s)", async (etag) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: etag ? { ETag: etag } : {} })),
  );
  const decoder = vi.fn(decode);
  expect(await loadJson("/items", validation('"v1"'), decoder)).toEqual({ modified: false, etag });
  expect(decoder).not.toHaveBeenCalled();
});

it("rejects HTTP errors, malformed JSON and decoder failures", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(loadJson("/items", validation(), decode)).rejects.toThrow("503");
  fetcher.mockResolvedValue(new Response("invalid json"));
  await expect(loadJson("/items", validation(), decode)).rejects.toBeInstanceOf(SyntaxError);
  fetcher.mockResolvedValue(Response.json(null));
  const error = new Error("Invalid response");
  await expect(
    loadJson("/items", validation(), () => {
      throw error;
    }),
  ).rejects.toBe(error);
});

it.each(["cache", "caller"])("combines cache cancellation with the caller's signal (%s)", async (origin) => {
  const cache = new AbortController();
  const caller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    }),
  );
  const pending = loadJson("/items", { etag: null, signal: cache.signal }, decode, { signal: caller.signal });
  (origin === "cache" ? cache : caller).abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
