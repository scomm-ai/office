import type { Pool } from "pg";

const MIGRATION_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS public_keys (
      identity_type text NOT NULL,
      identity_value text NOT NULL,
      key_id text NOT NULL,
      record jsonb NOT NULL,
      state text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      PRIMARY KEY (identity_type, identity_value, key_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS audit_events (
      id serial PRIMARY KEY,
      event text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS semantic_documents (
      id text PRIMARY KEY,
      document jsonb NOT NULL,
      digest text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS user_configurations (
      user_id text PRIMARY KEY,
      config jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
      ON audit_events (created_at DESC)
  `,
];

export async function migrate(pool: Pool): Promise<void> {
  for (const statement of MIGRATION_STATEMENTS) {
    await pool.query(statement);
  }
}
