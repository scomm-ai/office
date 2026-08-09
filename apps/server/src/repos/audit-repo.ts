import type { Pool } from "pg";
import type { AuditRepository, AuditEventRow } from "./types.js";

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async append(event: string, payload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO audit_events (event, payload)
        VALUES ($1, $2::jsonb)
      `,
      [event, JSON.stringify(payload)],
    );
  }

  async listRecent(limit = 50): Promise<AuditEventRow[]> {
    const result = await this.pool.query<{
      id: number;
      event: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `
        SELECT id, event, payload, created_at
        FROM audit_events
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      event: row.event,
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    }));
  }
}

export function redactAuditPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("token") ||
      lowerKey.includes("authorization") ||
      lowerKey.includes("privatekey") ||
      lowerKey.includes("private_key") ||
      lowerKey.includes("secret")
    ) {
      redacted[key] = "[redacted]";
      continue;
    }

    if (lowerKey === "publickey" || lowerKey === "public_key") {
      redacted[key] = "[redacted]";
      continue;
    }

    if (typeof value === "string" && value.length > 256) {
      redacted[key] = `${value.slice(0, 256)}…`;
      continue;
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactAuditPayload(value as Record<string, unknown>);
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
}
