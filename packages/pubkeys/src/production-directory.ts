import { UnsupportedFeatureError, PubkeyLookupError, normalizeEmailIdentity } from "@scomm-office/core";
import type { ScommIdentity } from "@scomm-office/identity";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import type { PublicKeyDirectory } from "./directory.js";
import type { FetchImpl } from "./http-directory.js";

export type PreferenceUsage = "encrypt" | "sign";

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function purposeForUsage(usage: PreferenceUsage): PublicKeyRecord["purpose"] {
  return usage === "encrypt" ? "encryption" : "signing";
}

function recordFromPreference(
  email: string,
  body: Record<string, unknown>,
  usage: PreferenceUsage,
): PublicKeyRecord | null {
  const keyId = body.keyId ?? body.key_id;
  const algorithm = body.algorithm;
  const publicKey = body.publicKey ?? body.public_key;
  if (typeof keyId !== "string" || typeof algorithm !== "string" || typeof publicKey !== "string") {
    return null;
  }
  return {
    version: 1,
    identity: { type: "email", value: email },
    keyId,
    algorithm,
    publicKey,
    encoding: "base64url",
    purpose: purposeForUsage(usage),
    state: "active",
    trust: "directory-asserted",
    ...(typeof body.label === "string" ? { metadata: { label: body.label } } : {}),
  };
}

/**
 * Production pubkey read directory (preference + VKS).
 * Write/bootstrap (OTP + signed upload) is P1 — `setKey` throws until then.
 */
export class ProductionPubkeyDirectory implements PublicKeyDirectory {
  constructor(
    private readonly readBaseUrl: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async getKeys(identity: ScommIdentity): Promise<PublicKeyRecord[]> {
    if (identity.type !== "email") {
      return [];
    }
    const email = normalizeEmailIdentity(identity.value).comparisonKey;
    const records: PublicKeyRecord[] = [];

    for (const usage of ["encrypt", "sign"] as const) {
      const url = joinUrl(
        this.readBaseUrl,
        `/keys/preference?email=${encodeURIComponent(email)}&usage=${usage}`,
      );
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (response.status === 404) {
          continue;
        }
        if (!response.ok) {
          throw new PubkeyLookupError(
            `Pubkey preference failed (${response.status}) for ${email}/${usage}`,
          );
        }
        const body = (await response.json()) as Record<string, unknown>;
        const record = recordFromPreference(email, body, usage);
        if (record) {
          records.push(record);
        }
      } catch (error) {
        if (error instanceof PubkeyLookupError) {
          throw error;
        }
        throw new PubkeyLookupError(
          `Pubkey preference network error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (records.length > 0) {
      return records;
    }

    // Fallback: VKS JSON keys (non-OpenPGP-only responses)
    const vksUrl = joinUrl(this.readBaseUrl, `/vks/v1/by-email/${encodeURIComponent(email)}`);
    const vksResponse = await this.fetchImpl(vksUrl, {
      method: "GET",
      headers: { Accept: "application/json, application/pgp-keys" },
    });
    if (vksResponse.status === 404) {
      return [];
    }
    if (!vksResponse.ok) {
      throw new PubkeyLookupError(`VKS lookup failed (${vksResponse.status}) for ${email}`);
    }
    const contentType = vksResponse.headers.get("content-type") ?? "";
    if (contentType.includes("application/pgp-keys")) {
      const armored = await vksResponse.text();
      return [
        {
          version: 1,
          identity: { type: "email", value: email },
          keyId: `vks:${email}`,
          algorithm: "openpgp",
          publicKey: armored,
          encoding: "base64url",
          purpose: "encryption",
          state: "active",
          trust: "directory-asserted",
          metadata: { source: "vks", format: "application/pgp-keys" },
        },
      ];
    }
    const json = (await vksResponse.json()) as { keys?: Array<Record<string, unknown>> };
    return (json.keys ?? []).flatMap((key) => {
      const keyId = key.keyId ?? key.key_id;
      const algorithm = key.algorithm;
      const publicKey = key.publicKey ?? key.public_key;
      if (typeof keyId !== "string" || typeof algorithm !== "string" || typeof publicKey !== "string") {
        return [];
      }
      return [
        {
          version: 1 as const,
          identity: { type: "email" as const, value: email },
          keyId,
          algorithm,
          publicKey,
          encoding: "base64url" as const,
          purpose: "encryption" as const,
          state: "active" as const,
          trust: "directory-asserted" as const,
          metadata: { source: "vks" },
        },
      ];
    });
  }

  async setKey(_record: PublicKeyRecord): Promise<PublicKeyRecord> {
    throw new UnsupportedFeatureError(
      "Production pubkey upload (OTP bootstrap + signed write) is not yet implemented. See openspec/features/pubkey-server-api.md",
    );
  }

  async revokeKey(_identity: ScommIdentity, _keyId: string): Promise<void> {
    throw new UnsupportedFeatureError(
      "Production pubkey revoke requires signed write API. See openspec/features/pubkey-server-api.md",
    );
  }
}

/** Choose production or legacy fixture directory based on URL hints. */
export function createPublicKeyDirectory(options: {
  pubkeyReadBaseUrl?: string;
  /** @deprecated Fixture Fastify `/api/v1/identities` base */
  legacyFixtureBaseUrl?: string;
  fetchImpl?: FetchImpl;
}): PublicKeyDirectory {
  const readUrl = options.pubkeyReadBaseUrl?.trim();
  if (readUrl) {
    return new ProductionPubkeyDirectory(readUrl, options.fetchImpl);
  }
  if (options.legacyFixtureBaseUrl?.trim()) {
    // Lazy import avoided — caller should construct HttpPublicKeyDirectory for fixtures.
    throw new Error("Use HttpPublicKeyDirectory explicitly for legacy fixture bases.");
  }
  throw new Error("pubkeyReadBaseUrl is required for production discovery.");
}
