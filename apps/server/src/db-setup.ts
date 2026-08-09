import { Pool } from "pg";

function adminConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function databaseName(databaseUrl: string): string {
  const name = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!name) {
    throw new Error("DATABASE_URL must include a database name");
  }
  return name;
}

export async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const dbName = databaseName(databaseUrl);
  const adminPool = new Pool({ connectionString: adminConnectionString(databaseUrl) });

  try {
    const existing = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      dbName,
    ]);
    if (existing.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminPool.end();
  }
}

export async function canConnect(databaseUrl: string): Promise<boolean> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
