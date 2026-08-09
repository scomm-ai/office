import { resolveEffectiveConfiguration } from "@scomm-office/config";
import { configGetResponseSchema, type UserConfiguration } from "@scomm-office/protocol";
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../env.js";
import type { UserConfigurationRepository } from "../repos/types.js";

function defaultUserConfiguration(config: ServerConfig): UserConfiguration {
  return {
    scommServerUrl: config.defaultServerUrl,
    pubkeyServerUrl: config.defaultPubkeyServerUrl,
    idrTargetHost: "localhost",
    idrDefaultService: "ollama",
    semanticAnalysisEnabled: true,
    complianceEnabled: true,
    experimentalEncryptionEnabled: false,
    diagnosticsEnabled: config.nodeEnv !== "production",
  };
}

export async function registerConfigRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  userConfigurations: UserConfigurationRepository,
): Promise<void> {
  app.get("/api/v1/config", async (request) => {
    const userId = request.headers["x-scomm-user-id"];
    const user =
      typeof userId === "string" && userId.trim()
        ? ((await userConfigurations.get(userId.trim())) ?? defaultUserConfiguration(config))
        : defaultUserConfiguration(config);

    const effective = resolveEffectiveConfiguration(user, config.organization);
    return configGetResponseSchema.parse(effective);
  });
}
