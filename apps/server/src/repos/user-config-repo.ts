import type { UserConfiguration } from "@scomm-office/protocol";
import type { Pool } from "pg";
import type { UserConfigurationRepository } from "./types.js";

export class PostgresUserConfigurationRepository implements UserConfigurationRepository {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<UserConfiguration | null> {
    const result = await this.pool.query<{ config: UserConfiguration }>(
      `
        SELECT config
        FROM user_configurations
        WHERE user_id = $1
      `,
      [userId],
    );
    return result.rows[0]?.config ?? null;
  }

  async save(userId: string, config: UserConfiguration): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO user_configurations (user_id, config, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (user_id)
        DO UPDATE SET config = EXCLUDED.config, updated_at = now()
      `,
      [userId, JSON.stringify(config)],
    );
  }
}
