import type { Pool } from "pg";
import { InMemoryPolicyRepository } from "./policy-repo.js";
import { PostgresAuditRepository } from "./audit-repo.js";
import { PostgresPublicKeyRepository } from "./public-key-repo.js";
import { PostgresSemanticRepository } from "./semantic-repo.js";
import { PostgresUserConfigurationRepository } from "./user-config-repo.js";
import type { Repositories } from "./types.js";

export function createRepositories(pool: Pool): Repositories {
  return {
    publicKeys: new PostgresPublicKeyRepository(pool),
    audit: new PostgresAuditRepository(pool),
    semantics: new PostgresSemanticRepository(pool),
    policy: new InMemoryPolicyRepository(),
    userConfigurations: new PostgresUserConfigurationRepository(pool),
  };
}

export * from "./types.js";
