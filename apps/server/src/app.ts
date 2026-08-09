import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { createAuthHook } from "./auth.js";
import { createPool } from "./db.js";
import { ensureDatabaseExists } from "./db-setup.js";
import type { ServerConfig } from "./env.js";
import { loadConfig } from "./env.js";
import { migrate } from "./migrate.js";
import { createRepositories, type Repositories } from "./repos/index.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPolicyRoutes } from "./routes/policies.js";
import { registerPubkeyRoutes } from "./routes/pubkeys.js";
import { registerSemanticRoutes } from "./routes/semantics.js";

export interface BuildAppOptions {
  config?: ServerConfig;
  pool?: Pool;
  repos?: Repositories;
  migrateOnStart?: boolean;
  ensureDatabase?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();

  if (options.ensureDatabase ?? false) {
    await ensureDatabaseExists(config.databaseUrl);
  }

  const pool = options.pool ?? createPool(config.databaseUrl);
  const repos = options.repos ?? createRepositories(pool);

  if (options.migrateOnStart ?? true) {
    await migrate(pool);
  }

  const app = Fastify({
    logger: config.nodeEnv !== "test",
  });

  await app.register(cors, {
    origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-SComm-User-Id"],
  });

  app.addHook("onRequest", createAuthHook(config));

  await registerHealthRoutes(app, pool);
  await registerConfigRoutes(app, config, repos.userConfigurations);
  await registerPubkeyRoutes(app, repos.publicKeys, repos.audit);
  await registerSemanticRoutes(app, repos.semantics, repos.audit);
  await registerPolicyRoutes(app, repos.policy, repos.audit);
  await registerAuditRoutes(app, repos.audit);

  app.addHook("onClose", async () => {
    if (!options.pool) {
      await pool.end();
    }
  });

  return app;
}

export { loadConfig };
export type { ServerConfig };
