import { createStore } from "idb-keyval";
import { metadata, type StorageBackend, type Stored, scope, stored } from "./storage";

/** @internal */
export function persistentStorage(namespace: string, schemaVersion: number): StorageBackend {
  const useStore = createStore("@oomol-lab/resource-cache", "records");
  const prefix = `${scope(namespace)}:${schemaVersion}:`;
  const identity = (key: string, part: string) => prefix + JSON.stringify([key, part]);

  // All callbacks run synchronously within IDB events. Host code and network waits
  // never run inside a transaction. Synchronous write failures explicitly abort it.
  function transaction<R>(
    mode: IDBTransactionMode,
    work: (
      store: IDBObjectStore,
      read: <T>(request: IDBRequest<T>, fn: (value: T) => void) => void,
      result: (value: R) => void,
    ) => void,
  ): Promise<R> {
    return useStore(
      mode,
      (store) =>
        new Promise<R>((resolve, reject) => {
          const tx = store.transaction;
          let value: R;
          let failure: unknown;
          tx.oncomplete = () => resolve(value);
          tx.onabort = () => reject(failure ?? tx.error);
          const guard = (fn: () => void) => {
            try {
              fn();
            } catch (error) {
              failure = error;
              tx.abort();
            }
          };
          const read = <T>(request: IDBRequest<T>, fn: (value: T) => void) => {
            request.onsuccess = () => guard(() => fn(request.result));
          };
          guard(() =>
            work(store, read, (result) => {
              value = result;
            }),
          );
        }),
    );
  }

  return {
    read(key, version) {
      return transaction<Stored | undefined>("readonly", (store, read, result) => {
        read(store.get(identity(key, "meta")), (raw) => {
          const meta = metadata(raw);
          if (!meta) return;
          if (meta.version === version) {
            result({ meta });
            return;
          }
          read(store.get(identity(key, "body")), (body) => result(stored(meta, body)));
        });
      });
    },
    write(key, entry, modified) {
      return transaction<boolean>("readwrite", (store, read, result) => {
        const { data, ...meta } = entry;
        if (modified) {
          store.put(meta, identity(key, "meta"));
          store.put({ version: meta.version, data }, identity(key, "body"));
          result(true);
        } else {
          read(store.get(identity(key, "meta")), (raw) => {
            const matches = metadata(raw)?.version === meta.version;
            if (matches) store.put(meta, identity(key, "meta"));
            result(matches);
          });
        }
      });
    },
    invalidate(key) {
      return transaction<Stored | undefined>("readwrite", (store, read, result) => {
        read(store.get(identity(key, "meta")), (raw) => {
          const meta = metadata(raw);
          if (!meta) return;
          meta.invalidated = true;
          store.put(meta, identity(key, "meta"));
          read(store.get(identity(key, "body")), (body) => result(stored(meta, body)));
        });
      });
    },
    remove(key) {
      return transaction<void>("readwrite", (store) => {
        store.delete(identity(key, "meta"));
        store.delete(identity(key, "body"));
      });
    },
    clear() {
      return transaction<void>("readwrite", (store, read) => {
        read(store.getAllKeys(), (keys) => {
          for (const key of keys) {
            if (typeof key === "string" && key.startsWith(prefix)) store.delete(key);
          }
        });
      });
    },
  };
}
