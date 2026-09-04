import type { SessionStore } from "@2key/browser-sdk/billing";

type OfficeRuntimeStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function officeRuntimeStorage(): OfficeRuntimeStorage | null {
  const runtime = (globalThis as { OfficeRuntime?: { storage?: OfficeRuntimeStorage } })
    .OfficeRuntime;
  const storage = runtime?.storage;
  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) {
    return null;
  }
  return storage;
}

function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* Outlook WebViews often block or drop localStorage */
  }
}

function deleteLocal(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * License JWT + device keys for Outlook. Memory first, then localStorage, then
 * OfficeRuntime.storage (survives taskpane WebView recreation).
 */
export function createOfficeSessionStore(): SessionStore {
  const memory = new Map<string, string>();

  return {
    async get(key: string): Promise<string | null> {
      const fromMemory = memory.get(key);
      if (fromMemory != null) return fromMemory;

      const fromLocal = readLocal(key);
      if (fromLocal != null) {
        memory.set(key, fromLocal);
        return fromLocal;
      }

      const runtime = officeRuntimeStorage();
      if (!runtime) return null;
      try {
        const fromRuntime = await runtime.getItem(key);
        if (fromRuntime != null) {
          memory.set(key, fromRuntime);
          writeLocal(key, fromRuntime);
          return fromRuntime;
        }
      } catch {
        return null;
      }
      return null;
    },

    async set(key: string, value: string): Promise<void> {
      memory.set(key, value);
      writeLocal(key, value);
      const runtime = officeRuntimeStorage();
      if (!runtime) return;
      try {
        await runtime.setItem(key, value);
      } catch {
        /* localStorage / memory still hold the license for this WebView */
      }
    },

    async delete(key: string): Promise<void> {
      memory.delete(key);
      deleteLocal(key);
      const runtime = officeRuntimeStorage();
      if (!runtime) return;
      try {
        await runtime.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

let sharedOfficeSessionStore: SessionStore | null = null;

/** Shared store so taskpane panels see the same in-memory license. */
export function officeBillingSessionStore(): SessionStore {
  sharedOfficeSessionStore ??= createOfficeSessionStore();
  return sharedOfficeSessionStore;
}

/** Test helper: drop the process-wide store. */
export function resetOfficeBillingSessionStore(): void {
  sharedOfficeSessionStore = null;
}
