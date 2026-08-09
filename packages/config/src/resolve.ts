import type {
  ConfigurationFieldKey,
  EffectiveConfiguration,
  OrganizationConfiguration,
  ResolvedConfiguration,
  UserConfiguration,
} from "@scomm-office/protocol";

const CONFIGURATION_FIELDS: ConfigurationFieldKey[] = [
  "scommServerUrl",
  "pubkeyServerUrl",
  "idrTargetHost",
  "idrDefaultService",
  "semanticAnalysisEnabled",
  "complianceEnabled",
  "experimentalEncryptionEnabled",
  "diagnosticsEnabled",
];

function setConfigurationField(
  target: ResolvedConfiguration,
  field: ConfigurationFieldKey,
  value: string | boolean,
): void {
  switch (field) {
    case "scommServerUrl":
    case "pubkeyServerUrl":
      target[field] = value as string;
      break;
    case "idrTargetHost":
    case "idrDefaultService":
      target[field] = value as string;
      break;
    case "semanticAnalysisEnabled":
    case "complianceEnabled":
    case "experimentalEncryptionEnabled":
    case "diagnosticsEnabled":
      target[field] = value as boolean;
      break;
  }
}

function pickDefinedConfiguration(
  source: Partial<ResolvedConfiguration>,
): Partial<ResolvedConfiguration> {
  const picked: Partial<ResolvedConfiguration> = {};
  for (const field of CONFIGURATION_FIELDS) {
    const value = source[field];
    if (value !== undefined) {
      setConfigurationField(picked as ResolvedConfiguration, field, value);
    }
  }
  return picked;
}

function mergeResolvedConfiguration(
  user: UserConfiguration,
  organization?: OrganizationConfiguration,
): ResolvedConfiguration {
  const enforced = new Set(organization?.enforcedFields ?? []);
  const effective: ResolvedConfiguration = { ...pickDefinedConfiguration(user) };

  if (!organization) {
    return effective;
  }

  const orgValues = pickDefinedConfiguration(organization);

  for (const field of CONFIGURATION_FIELDS) {
    const orgValue = orgValues[field];
    if (orgValue === undefined) {
      continue;
    }
    if (enforced.has(field)) {
      setConfigurationField(effective, field, orgValue);
    } else if (effective[field] === undefined) {
      setConfigurationField(effective, field, orgValue);
    }
  }

  return effective;
}

export function resolveEffectiveConfiguration(
  user: UserConfiguration,
  organization?: OrganizationConfiguration,
): EffectiveConfiguration {
  return {
    user,
    organization,
    effective: mergeResolvedConfiguration(user, organization),
  };
}

export { CONFIGURATION_FIELDS };
