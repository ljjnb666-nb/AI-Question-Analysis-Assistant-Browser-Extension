/**
 * Test-only in-memory chrome.storage.local implementation.
 *
 * Values are deep-copied through JSON on both read and write, matching the
 * structured-clone boundary of real chrome.storage, so tests catch mutations
 * of objects after they are handed to storage.
 */

import { vi } from "vitest";

export type MemoryStorageMap = Map<string, unknown>;

export interface MemoryStorageHandle {
  store: MemoryStorageMap;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

export function installMemoryStorage(): MemoryStorageHandle {
  const store: MemoryStorageMap = new Map();

  const get = vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
    const wanted =
      keys === null || keys === undefined
        ? [...store.keys()]
        : Array.isArray(keys)
          ? keys
          : typeof keys === "string"
            ? [keys]
            : Object.keys(keys);
    const result: Record<string, unknown> = {};
    for (const key of wanted) {
      if (store.has(key)) result[key] = JSON.parse(JSON.stringify(store.get(key)));
    }
    return result;
  });

  const set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    }
  });

  const remove = vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
  });

  const local = chrome.storage.local as unknown as Record<string, unknown>;
  local.get = get;
  local.set = set;
  local.remove = remove;

  return { store, get, set, remove };
}

/** Serialize one stored value (or the whole store) for plaintext-leak asserts. */
export function dumpStoreJson(store: MemoryStorageMap, key?: string): string {
  const source = key === undefined ? Object.fromEntries(store) : { [key]: store.get(key) };
  return JSON.stringify(source);
}
