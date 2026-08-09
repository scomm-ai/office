import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { buildApp, loadConfig } from "../src/app.js";
import { ensureDatabaseExists } from "../src/db-setup.js";
import type { PublicKeyRecord } from "@scomm-office/protocol";

const config = loadConfig({
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/scomm_office",
  SCOMM_DEV_TOKEN: process.env.SCOMM_DEV_TOKEN ?? "dev-token",
});

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.devToken}`,
    "Content-Type": "application/json",
  };
}

function makeRecord(keyId: string): PublicKeyRecord {
  return {
    version: 1,
    identity: { type: "email", value: "server-test@example.com" },
    keyId,
    algorithm: "Ed25519",
    publicKey: "dGVzdC1rZXk",
    encoding: "base64url",
    purpose: "signing",
    state: "active",
    trust: "directory-asserted",
    createdAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("server integration", () => {
  let pool: Pool;
  let app: FastifyInstance;
  const testKeyId = `integration-${Date.now()}`;

  beforeAll(async () => {
    await ensureDatabaseExists(config.databaseUrl);
    pool = new Pool({ connectionString: config.databaseUrl });
    app = await buildApp({ config, pool, migrateOnStart: true, ensureDatabase: false });
    await app.ready();
  });

  afterAll(async () => {
    await pool.query(
      `
        DELETE FROM public_keys
        WHERE identity_type = 'email'
          AND identity_value = 'server-test@example.com'
          AND key_id = $1
      `,
      [testKeyId],
    );
    await app.close();
    await pool.end();
  });

  it("returns health status", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns ready when database is reachable", async () => {
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ready: true });
  });

  it("stores, lists, and revokes public keys", async () => {
    const record = makeRecord(testKeyId);
    const identityPath = encodeURIComponent("email");
    const identityValue = encodeURIComponent(record.identity.value);
    const keyPath = encodeURIComponent(record.keyId);

    const putResponse = await app.inject({
      method: "PUT",
      url: `/api/v1/identities/${identityPath}/${identityValue}/keys/${keyPath}`,
      headers: authHeaders(),
      payload: record,
    });
    expect(putResponse.statusCode).toBe(200);
    expect(putResponse.json().key.keyId).toBe(testKeyId);

    const listResponse = await app.inject({
      method: "GET",
      url: `/api/v1/identities/${identityPath}/${identityValue}/keys`,
      headers: authHeaders(),
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().keys.some((key: PublicKeyRecord) => key.keyId === testKeyId)).toBe(
      true,
    );

    const revokeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/identities/${identityPath}/${identityValue}/keys/${keyPath}/revoke`,
      headers: authHeaders(),
      payload: { reason: "integration-test" },
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.json().key.state).toBe("revoked");
  });

  it("rejects missing auth on protected routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/config",
    });
    expect(response.statusCode).toBe(401);
  });
});
