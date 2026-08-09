import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { pingDatabase } from "../db.js";

export async function registerHealthRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/health", async () => ({ status: "ok" as const }));

  app.get("/ready", async () => {
    const ready = await pingDatabase(pool);
    return { ready };
  });

  app.get("/version", async () => ({
    version: "0.1.0",
    protocolVersion: "1",
  }));
}
