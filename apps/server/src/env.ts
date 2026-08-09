import type { ConfigurationFieldKey, OrganizationConfiguration } from "@scomm-office/protocol";

export interface ServerConfig {
  databaseUrl: string;
  devToken: string;
  port: number;
  host: string;
  nodeEnv: string;
  organization?: OrganizationConfiguration;
  defaultServerUrl: string;
  defaultPubkeyServerUrl: string;
}

const ORG_FIELD_ENV: Record<ConfigurationFieldKey, string> = {
  scommServerUrl: "SCOMM_ORG_SCOMM_SERVER_URL",
  pubkeyServerUrl: "SCOMM_ORG_PUBKEY_SERVER_URL",
  idrTargetHost: "SCOMM_ORG_IDR_TARGET_HOST",
  idrDefaultService: "SCOMM_ORG_IDR_DEFAULT_SERVICE",
  semanticAnalysisEnabled: "SCOMM_ORG_SEMANTIC_ANALYSIS_ENABLED",
  complianceEnabled: "SCOMM_ORG_COMPLIANCE_ENABLED",
  experimentalEncryptionEnabled: "SCOMM_ORG_EXPERIMENTAL_ENCRYPTION_ENABLED",
  diagnosticsEnabled: "SCOMM_ORG_DIAGNOSTICS_ENABLED",
};

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function loadOrganizationConfig(): OrganizationConfiguration | undefined {
  const organization: OrganizationConfiguration = {};
  let hasValues = false;

  for (const [field, envName] of Object.entries(ORG_FIELD_ENV) as Array<
    [ConfigurationFieldKey, string]
  >) {
    const raw = process.env[envName];
    if (raw === undefined || raw === "") {
      continue;
    }

    if (
      field === "semanticAnalysisEnabled" ||
      field === "complianceEnabled" ||
      field === "experimentalEncryptionEnabled" ||
      field === "diagnosticsEnabled"
    ) {
      const parsed = readBoolean(raw);
      if (parsed !== undefined) {
        organization[field] = parsed;
        hasValues = true;
      }
      continue;
    }

    organization[field] = raw;
    hasValues = true;
  }

  const enforcedRaw = process.env.SCOMM_ORG_ENFORCED_FIELDS;
  if (enforcedRaw) {
    organization.enforcedFields = enforcedRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) as ConfigurationFieldKey[];
    hasValues = true;
  }

  return hasValues ? organization : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? "8787");
  const host = env.HOST ?? "0.0.0.0";
  const defaultServerUrl = env.SCOMM_SERVER_URL ?? `http://localhost:${port}`;
  const defaultPubkeyServerUrl = env.SCOMM_PUBKEY_SERVER_URL ?? defaultServerUrl;

  return {
    databaseUrl:
      env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/scomm_office",
    devToken: env.SCOMM_DEV_TOKEN ?? "dev-token",
    port: Number.isFinite(port) ? port : 8787,
    host,
    nodeEnv: env.NODE_ENV ?? "development",
    organization: loadOrganizationConfig(),
    defaultServerUrl,
    defaultPubkeyServerUrl,
  };
}
