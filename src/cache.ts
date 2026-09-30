import type { Entry, StorageBackend, Stored } from "./storage";
import type { CacheOptions, ResourceCache } from "./types";

interface Job<T> {
  promise: Promise<T>;
  started: boolean;
  force: boolean;
}

interface State<T> {
  controller: AbortController;
  entry?: Entry<T>;
  // A scope token distinguishes inherited clear barriers from later per-key cleanup.
  blocked: boolean | object;
  job?: Job<T>;
  queued?: Promise<T>;
}

function abortError() {
  return new DOMException("Cache operation aborted", "AbortError");
}

// Rejection handlers stay attached even after cancellation: a host may ignore
// AbortSignal and settle its request much later.
function wait<T>(promise: Promise<T>, lifetime: AbortSignal, caller?: AbortSignal): Promise<T> {
  const signals = caller ? [lifetime, caller] : [lifetime];
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(abortError());
    };
    for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** @internal */
export function validateOptions<T, Q>(options: CacheOptions<T, Q>): void {
  if (typeof options.namespace !== "string" || !options.namespace.trim())
    throw new TypeError("namespace must be nonempty");
  if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion <= 0)
    throw new TypeError("schemaVersion must be a positive safe integer");
  if (!Number.isFinite(options.maxAge) || options.maxAge < 0)
    throw new TypeError("maxAge must be finite and nonnegative");
  for (const name of ["key", "decode", "load"] as const) {
    if (typeof options[name] !== "function") throw new TypeError(`${name} must be a function`);
  }
}

/** @internal */
export function createCache<T, Q>(
  options: CacheOptions<T, Q>,
  backend: StorageBackend,
  session: boolean,
): ResourceCache<T, Q> {
  const states = new Map<string, State<T>>();
  let disposed = false;
  let scopeBlocked: false | object = false;
  let disposal: Promise<void> | undefined;
  let io: Promise<unknown> = Promise.resolve();

  // Queue storage work, not network work. A removal is ordered after writes
  // already submitted, and every later write checks its lifetime inside the queue.
  function storage<R>(action: () => Promise<R>): Promise<R> {
    const result = io.then(action);
    io = result.catch(() => {});
    return result;
  }

  function checkOpen() {
    if (disposed) throw new Error("Cache is disposed");
  }

  function identity(query: Q): string {
    checkOpen();
    const key = options.key(query);
    if (typeof key !== "string") throw new TypeError("key must return a string");
    return key;
  }

  function stateFor(key: string): State<T> {
    let state = states.get(key);
    if (!state) {
      state = { controller: new AbortController(), blocked: scopeBlocked };
      states.set(key, state);
    }
    return state;
  }

  function checkState(state: State<T>) {
    if (state.controller.signal.aborted) throw abortError();
  }

  function fresh(entry: Entry<T>): boolean {
    const now = Date.now();
    return !entry.invalidated && entry.validatedAt <= now && now - entry.validatedAt < options.maxAge;
  }

  function restore(value: Stored, previous?: Entry<T>): Entry<T> {
    return { ...value.meta, data: value.body ? options.decode(value.body.data) : (previous as Entry<T>).data };
  }

  async function read(key: string, state: State<T>): Promise<Entry<T> | undefined> {
    if (state.entry && fresh(state.entry)) return state.entry;
    const entry = await storage(async () => {
      checkState(state);
      if (state.blocked) return state.entry;
      try {
        const value = await backend.read(key, state.entry?.version);
        return value ? restore(value, state.entry) : state.entry;
      } catch {
        return state.entry;
      }
    });
    checkState(state);
    state.entry = entry;
    return entry;
  }

  function schedule(key: string, query: Q, state: State<T>, force: boolean): Job<T> {
    const job = { started: false, force } as Job<T>;
    job.promise = (async () => {
      const previous = await read(key, state);
      checkState(state);
      if (!job.force && previous && fresh(previous)) return previous.data;
      job.started = true;
      const result = await options.load(query, { etag: previous?.etag ?? null, signal: state.controller.signal });
      checkState(state);
      let entry: Entry<T>;
      if (result.modified) {
        entry = {
          data: result.data,
          etag: result.etag,
          version: crypto.getRandomValues(new Uint32Array(4)).join("-"),
          validatedAt: Date.now(),
          invalidated: false,
        };
      } else {
        if (!previous) throw new Error("Load protocol error: unmodified response without cached data");
        entry = {
          ...previous,
          etag: result.etag === undefined ? previous.etag : result.etag,
          validatedAt: Date.now(),
          invalidated: false,
        };
      }
      await storage(async () => {
        checkState(state);
        try {
          if (await backend.write(key, entry, result.modified)) state.blocked = false;
        } catch {
          // Retain the successful in-memory version. Old storage must not replace
          // a response that could not be persisted, or bypass failed cleanup.
          state.blocked = true;
        }
        checkState(state);
        state.entry = entry;
      });
      checkState(state);
      return entry.data;
    })();
    state.job = job;
    // Registered before queued continuations, so the slot is released before
    // any next round starts, on either outcome.
    const release = () => {
      state.job = undefined;
    };
    job.promise.then(release, release);
    return job;
  }

  function refresh(key: string, query: Q, state: State<T>, force: boolean): Promise<T> {
    const active = state.job;
    if (!active) return schedule(key, query, state, force).promise;
    if (!force) return active.promise;
    if (!active.started) {
      active.force = true;
      return active.promise;
    }
    if (!state.queued) {
      const start = () => {
        checkState(state);
        state.queued = undefined;
        return schedule(key, query, state, true).promise;
      };
      state.queued = active.promise.then(start, start);
    }
    return state.queued;
  }

  // Publish the new lifetime first. Notify host abort listeners only after the
  // operation has queued its cleanup; listeners may synchronously call back in.
  function reset(key: string, keep: boolean) {
    const old = states.get(key);
    const state: State<T> = { controller: new AbortController(), blocked: true };
    if (keep && old?.entry) state.entry = { ...old.entry, invalidated: true };
    states.set(key, state);
    return { state, cancel: () => old?.controller.abort() };
  }

  function resetAll() {
    const old = [...states.values()];
    states.clear();
    const barrier = {};
    scopeBlocked = barrier;
    return {
      barrier,
      cancel() {
        for (const state of old) state.controller.abort();
      },
    };
  }

  return {
    async get(query, getOptions = {}) {
      const key = identity(query);
      if (getOptions.signal?.aborted) throw abortError();
      const state = stateFor(key);
      if (!getOptions.revalidate && state.entry && fresh(state.entry)) return state.entry.data;
      return wait(
        refresh(key, query, state, getOptions.revalidate === true),
        state.controller.signal,
        getOptions.signal,
      );
    },
    async peek(query) {
      const key = identity(query);
      const state = stateFor(key);
      const entry = await wait(read(key, state), state.controller.signal);
      return entry
        ? { data: entry.data, etag: entry.etag, validatedAt: entry.validatedAt, fresh: fresh(entry) }
        : undefined;
    },
    async invalidate(query) {
      const key = identity(query);
      const canRestore = !(states.get(key)?.blocked ?? scopeBlocked);
      const { state, cancel } = reset(key, true);
      const cleanup = storage(async () => {
        const value = await backend.invalidate(key);
        if (canRestore) state.blocked = false;
        if (canRestore && !state.controller.signal.aborted && !state.entry && value) {
          try {
            state.entry = restore(value);
          } catch {
            /* Invalid stored bodies remain misses. */
          }
        }
      });
      cancel();
      await cleanup;
    },
    async remove(query) {
      const key = identity(query);
      const { state, cancel } = reset(key, false);
      const cleanup = storage(async () => {
        await backend.remove(key);
        state.blocked = false;
      });
      cancel();
      await cleanup;
    },
    async clear() {
      checkOpen();
      const { barrier, cancel } = resetAll();
      const cleanup = storage(async () => {
        await backend.clear(false);
        if (scopeBlocked === barrier) scopeBlocked = false;
        for (const state of states.values()) {
          if (state.blocked === barrier) state.blocked = false;
        }
      });
      cancel();
      await cleanup;
    },
    dispose() {
      if (!disposal) {
        disposed = true;
        const { cancel } = resetAll();
        disposal = storage(async () => {
          if (session) await backend.clear(true);
        });
        disposal = disposal.catch((error) => {
          disposal = undefined;
          throw error;
        });
        cancel();
      }
      return disposal;
    },
  };
}
