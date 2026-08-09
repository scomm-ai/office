import { PubkeyLookupError } from "@scomm-office/core";
import { identityToProtocolIdentity, parseIdentity, type ScommIdentity } from "@scomm-office/identity";
import {
  pubkeyListResponseSchema,
  pubkeyPutResponseSchema,
  type PublicKeyRecord,
} from "@scomm-office/protocol";
import type { PublicKeyDirectory } from "./directory.js";

export type FetchImpl = typeof fetch;

function identityPath(identity: ScommIdentity): string {
  const protocolIdentity = identityToProtocolIdentity(identity);
  return `/api/v1/identities/${encodeURIComponent(protocolIdentity.type)}/${encodeURIComponent(protocolIdentity.value)}`;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text || response.statusText;
  } catch {
    return response.statusText;
  }
}

export class HttpPublicKeyDirectory implements PublicKeyDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchImpl = fetch,
    private readonly getToken?: () => Promise<string | undefined>,
  ) {}

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken?.();
    if (!token) {
      return {};
    }
    return { Authorization: `Bearer ${token}` };
  }

  async getKeys(identity: ScommIdentity): Promise<PublicKeyRecord[]> {
    const url = joinUrl(this.baseUrl, `${identityPath(identity)}/keys`);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(await this.authHeaders()),
      },
    });

    if (!response.ok) {
      throw new PubkeyLookupError(
        `Pubkey lookup failed (${response.status}): ${await readErrorMessage(response)}`,
      );
    }

    const json: unknown = await response.json();
    const parsed = pubkeyListResponseSchema.parse(json);
    return parsed.keys;
  }

  async setKey(record: PublicKeyRecord): Promise<PublicKeyRecord> {
    const identity = parseIdentity(record.identity.type, record.identity.value);
    const url = joinUrl(
      this.baseUrl,
      `${identityPath(identity)}/keys/${encodeURIComponent(record.keyId)}`,
    );
    const response = await this.fetchImpl(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify(record),
    });

    if (!response.ok) {
      throw new PubkeyLookupError(
        `Pubkey upsert failed (${response.status}): ${await readErrorMessage(response)}`,
      );
    }

    const json: unknown = await response.json();
    const parsed = pubkeyPutResponseSchema.parse(json);
    return parsed.key;
  }

  async revokeKey(identity: ScommIdentity, keyId: string, reason?: string): Promise<void> {
    const url = joinUrl(
      this.baseUrl,
      `${identityPath(identity)}/keys/${encodeURIComponent(keyId)}/revoke`,
    );
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(await this.authHeaders()),
      },
      body: JSON.stringify(reason !== undefined ? { reason } : {}),
    });

    if (!response.ok) {
      throw new PubkeyLookupError(
        `Pubkey revoke failed (${response.status}): ${await readErrorMessage(response)}`,
      );
    }
  }
}
