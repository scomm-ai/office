import "dotenv/config";
import { buildApp, loadConfig } from "./app.js";
import { ensureDatabaseExists } from "./db-setup.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureDatabaseExists(config.databaseUrl);
  const app = await buildApp({ config, migrateOnStart: true, ensureDatabase: false });

  try {
    await app.listen({ port: config.port, host: config.host });
    console.info(`SComm Office server listening on http://${config.host}:${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
