import { UnsupportedFeatureError, PubkeyLookupError } from "@scomm-office/core";
import {
  PgpEngine,
  PubkeyClient,
  WebCryptoProvider,
  normalizeEmail,
} from "@scomm/pubkey";
import type { ScommIdentity } from "@scomm-office/identity";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import type { PublicKeyDirectory } from "./directory.js";
import type { FetchImpl } from "./http-directory.js";

/**
 * Production directory backed by the SComm JS Pubkey SDK.
 * Discovery capabilities come from the SDK provider, not hardcoded PGP/PQ claims.
 * Office.js-specific behavior stays out of the SDK.
 */
export class ProductionPubkeyDirectory implements PublicKeyDirectory {
  private readonly client: PubkeyClient;

  constructor(
    private readonly readBaseUrl: string,
    private readonly fetchImpl: FetchImpl = (...args) => fetch(...args),
    writeBaseUrl?: string,
  ) {
    const crypto = new WebCryptoProvider();
    this.client = new PubkeyClient({
      readBaseUrl,
      writeBaseUrl: writeBaseUrl ?? readBaseUrl,
      crypto,
      pgpEngine: new PgpEngine(crypto),
      fetchImpl: fetchImpl as typeof fetch,
    });
  }

  async getKeys(identity: ScommIdentity): Promise<PublicKeyRecord[]> {
    if (identity.type !== "email") {
      return [];
    }
    const email = normalizeEmail(identity.value);
    try {
      const selected = await this.client.getBestKey({
        email,
        purpose: "encryption",
      });
      if (!selected) {
        return [];
      }
      return [
        {
          version: 1,
          identity: { type: "email", value: email },
          keyId: String(selected.key_id ?? ""),
          algorithm: String(selected.suite ?? selected.algorithm ?? ""),
          publicKey: String(selected.public_material ?? ""),
          encoding: "base64url",
          purpose: selected.purpose === "signing" ? "signing" : "encryption",
          state: "active",
          trust: "directory-asserted",
          metadata: { family: selected.family, ...(selected.metadata ?? {}) },
        },
      ];
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "capability_mismatch" || code === "unknown_principal") {
        return [];
      }
      throw new PubkeyLookupError(
        `Pubkey lookup failed for ${email}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async setKey(_record: PublicKeyRecord): Promise<PublicKeyRecord> {
    throw new UnsupportedFeatureError(
      "Use PubkeyClient.setKeys with an armed MSK. Office UI should call the SDK, not this directory.",
    );
  }

  async revokeKey(_identity: ScommIdentity, _keyId: string): Promise<void> {
    throw new UnsupportedFeatureError(
      "Use PubkeyClient.retireKey with an armed MSK.",
    );
  }
}

export function createPublicKeyDirectory(options: {
  pubkeyReadBaseUrl?: string;
  legacyFixtureBaseUrl?: string;
  fetchImpl?: FetchImpl;
}): PublicKeyDirectory {
  const readUrl = options.pubkeyReadBaseUrl?.trim();
  if (readUrl) {
    return new ProductionPubkeyDirectory(readUrl, options.fetchImpl);
  }
  if (options.legacyFixtureBaseUrl?.trim()) {
    throw new Error("Use HttpPublicKeyDirectory explicitly for legacy fixture bases.");
  }
  throw new Error("pubkeyReadBaseUrl is required for production discovery.");
}
