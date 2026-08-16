import {
  PubkeyClient,
  Vault,
  MemoryVaultStore,
  PgpEngine,
  createDefaultJsRegistry,
} from "@scomm/pubkey";
import type { VaultStore } from "@scomm/pubkey";

/**
 * Headless SDK construction for task pane or event-based activation.
 * Provider selection is policy-driven (WebCrypto first). Office.js stays out.
 * OpenPGP is wired so discovery advertises pgp and compose can encrypt.
 */
export function createPubkeyClient(options: {
  readBaseUrl: string;
  writeBaseUrl?: string;
  store?: VaultStore;
  fetchImpl?: typeof fetch;
}) {
  const registry = createDefaultJsRegistry();
  const crypto = registry.discover()[0]!;
  const store = options.store ?? new MemoryVaultStore();
  const vault = new Vault({ crypto, store });
  const pgpEngine = new PgpEngine(crypto);
  const client = new PubkeyClient({
    readBaseUrl: options.readBaseUrl,
    writeBaseUrl: options.writeBaseUrl ?? options.readBaseUrl,
    crypto,
    vault,
    pgpEngine,
    fetchImpl: options.fetchImpl,
  });
  return { client, crypto, vault, pgpEngine, registry };
}
