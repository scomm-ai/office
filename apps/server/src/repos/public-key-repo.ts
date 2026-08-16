import { normalizeEmail } from "@scomm-office/core";
import type { IdentityType, PublicKeyRecord } from "@scomm-office/protocol";
import type { Pool } from "pg";
import type { PublicKeyRepository } from "./types.js";

function storageIdentity(type: IdentityType, value: string): { type: string; value: string } {
  if (type === "email") {
    const canonical = normalizeEmail(value);
    return { type: "email", value: canonical };
  }
  return { type, value: value.trim() };
}

function rowToRecord(row: {
  record: PublicKeyRecord;
}): PublicKeyRecord {
  return row.record;
}

export class PostgresPublicKeyRepository implements PublicKeyRepository {
  constructor(private readonly pool: Pool) {}

  async listKeys(identityType: string, identityValue: string): Promise<PublicKeyRecord[]> {
    const identity = storageIdentity(identityType as IdentityType, identityValue);
    const result = await this.pool.query<{ record: PublicKeyRecord }>(
      `
        SELECT record
        FROM public_keys
        WHERE identity_type = $1 AND identity_value = $2
        ORDER BY updated_at DESC
      `,
      [identity.type, identity.value],
    );
    return result.rows.map(rowToRecord);
  }

  async getKey(
    identityType: string,
    identityValue: string,
    keyId: string,
  ): Promise<PublicKeyRecord | null> {
    const identity = storageIdentity(identityType as IdentityType, identityValue);
    const result = await this.pool.query<{ record: PublicKeyRecord }>(
      `
        SELECT record
        FROM public_keys
        WHERE identity_type = $1 AND identity_value = $2 AND key_id = $3
      `,
      [identity.type, identity.value, keyId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async upsertKey(record: PublicKeyRecord): Promise<PublicKeyRecord> {
    const identity = storageIdentity(record.identity.type, record.identity.value);
    const now = new Date().toISOString();
    const stored: PublicKeyRecord = {
      ...record,
      identity: { type: record.identity.type, value: identity.value },
      state: record.state ?? "active",
      createdAt: record.createdAt ?? now,
    };

    await this.pool.query(
      `
        INSERT INTO public_keys (
          identity_type, identity_value, key_id, record, state, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, now()), now())
        ON CONFLICT (identity_type, identity_value, key_id)
        DO UPDATE SET
          record = EXCLUDED.record,
          state = EXCLUDED.state,
          updated_at = now(),
          revoked_at = NULL
      `,
      [
        identity.type,
        identity.value,
        record.keyId,
        JSON.stringify(stored),
        stored.state ?? "active",
        stored.createdAt ?? null,
      ],
    );

    return stored;
  }

  async revokeKey(
    identityType: string,
    identityValue: string,
    keyId: string,
    reason?: string,
  ): Promise<PublicKeyRecord | null> {
    const existing = await this.getKey(identityType, identityValue, keyId);
    if (!existing) {
      return null;
    }

    const revoked: PublicKeyRecord = {
      ...existing,
      state: "revoked",
      metadata: {
        ...existing.metadata,
        ...(reason !== undefined ? { revokeReason: reason } : {}),
      },
    };
    const identity = storageIdentity(identityType as IdentityType, identityValue);

    await this.pool.query(
      `
        UPDATE public_keys
        SET record = $4::jsonb,
            state = 'revoked',
            updated_at = now(),
            revoked_at = now()
        WHERE identity_type = $1 AND identity_value = $2 AND key_id = $3
      `,
      [identity.type, identity.value, keyId, JSON.stringify(revoked)],
    );

    return revoked;
  }
}
