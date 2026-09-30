import { metadata, type StorageBackend, scope, stored } from "./storage";

/** @internal */
export function sessionStorageBackend(namespace: string, schemaVersion: number, sessionId: string): StorageBackend {
  const base = `${scope(namespace, sessionId)}:`;
  const prefix = `${base}${schemaVersion}:`;
  const identity = (key: string) => prefix + JSON.stringify(key);
  const record = (key: string) => {
    const text = globalThis.sessionStorage.getItem(identity(key));
    if (text === null) return undefined;
    const raw: unknown = JSON.parse(text);
    const meta = metadata(raw);
    return meta ? stored(meta, raw) : undefined;
  };

  return {
    async read(key, version) {
      const value = record(key);
      if (value && value.meta.version === version) return { meta: value.meta };
      return value;
    },
    async write(key, entry, modified) {
      if (modified) {
        globalThis.sessionStorage.setItem(identity(key), JSON.stringify(entry));
        return true;
      } else {
        const value = record(key);
        if (value?.meta.version === entry.version) {
          // Retain the original JSON body. Decoded data may have been restored to
          // a different runtime shape, and a 304 must only change validators.
          const { data: _data, ...meta } = entry;
          globalThis.sessionStorage.setItem(identity(key), JSON.stringify({ ...meta, data: value.body.data }));
          return true;
        }
        return false;
      }
    },
    async invalidate(key) {
      const value = record(key);
      if (value) {
        value.meta.invalidated = true;
        globalThis.sessionStorage.setItem(identity(key), JSON.stringify({ ...value.meta, ...value.body }));
      }
      return value;
    },
    async remove(key) {
      globalThis.sessionStorage.removeItem(identity(key));
    },
    async clear(allVersions) {
      const storage = globalThis.sessionStorage;
      const matches: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) as string;
        if (key.startsWith(allVersions ? base : prefix)) matches.push(key);
      }
      for (const key of matches) storage.removeItem(key);
    },
  };
}
