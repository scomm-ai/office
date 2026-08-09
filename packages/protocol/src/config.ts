import { z } from "zod";

export const configurationFieldKeySchema = z.enum([
  "scommServerUrl",
  "pubkeyServerUrl",
  "pubkeyReadBaseUrl",
  "pubkeyWriteBaseUrl",
  "billingOrigin",
  "billingPortalUrl",
  "idrTargetHost",
  "idrDefaultService",
  "semanticAnalysisEnabled",
  "complianceEnabled",
  "experimentalEncryptionEnabled",
  "diagnosticsEnabled",
  "requireAiAddonEntitlement",
]);

export type ConfigurationFieldKey = z.infer<typeof configurationFieldKeySchema>;

const urlField = z.string().url().optional();
const hostField = z.string().min(1).optional();
const serviceField = z.string().min(1).optional();
const boolField = z.boolean().optional();

export const resolvedConfigurationSchema = z.object({
  /** @deprecated Fixture Fastify only — not used in product paths */
  scommServerUrl: urlField,
  /** @deprecated Prefer pubkeyReadBaseUrl */
  pubkeyServerUrl: urlField,
  pubkeyReadBaseUrl: urlField,
  pubkeyWriteBaseUrl: urlField,
  billingOrigin: urlField,
  billingPortalUrl: urlField,
  idrTargetHost: hostField,
  idrDefaultService: serviceField,
  semanticAnalysisEnabled: boolField,
  complianceEnabled: boolField,
  experimentalEncryptionEnabled: boolField,
  diagnosticsEnabled: boolField,
  requireAiAddonEntitlement: boolField,
});

export type ResolvedConfiguration = z.infer<typeof resolvedConfigurationSchema>;

export const userConfigurationSchema = resolvedConfigurationSchema;

export type UserConfiguration = z.infer<typeof userConfigurationSchema>;

export const organizationConfigurationSchema = resolvedConfigurationSchema.extend({
  enforcedFields: z.array(configurationFieldKeySchema).optional(),
});

export type OrganizationConfiguration = z.infer<typeof organizationConfigurationSchema>;

export const effectiveConfigurationSchema = z.object({
  user: userConfigurationSchema,
  organization: organizationConfigurationSchema.optional(),
  effective: resolvedConfigurationSchema,
});

export type EffectiveConfiguration = z.infer<typeof effectiveConfigurationSchema>;
