import { z } from "zod";
import { effectiveConfigurationSchema } from "./config.js";
import { publicKeyRecordSchema } from "./pubkey.js";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readyResponseSchema = z.object({
  ready: z.boolean(),
});

export type ReadyResponse = z.infer<typeof readyResponseSchema>;

export const versionResponseSchema = z.object({
  version: z.string().min(1),
  protocolVersion: z.string().optional(),
  build: z.string().optional(),
});

export type VersionResponse = z.infer<typeof versionResponseSchema>;

export const pubkeyListResponseSchema = z.object({
  keys: z.array(publicKeyRecordSchema),
});

export type PubkeyListResponse = z.infer<typeof pubkeyListResponseSchema>;

export const pubkeyGetResponseSchema = z.object({
  key: publicKeyRecordSchema,
});

export type PubkeyGetResponse = z.infer<typeof pubkeyGetResponseSchema>;

export const pubkeyPutRequestSchema = publicKeyRecordSchema;

export type PubkeyPutRequest = z.infer<typeof pubkeyPutRequestSchema>;

export const pubkeyPutResponseSchema = z.object({
  key: publicKeyRecordSchema,
});

export type PubkeyPutResponse = z.infer<typeof pubkeyPutResponseSchema>;

export const configGetResponseSchema = effectiveConfigurationSchema;

export type ConfigGetResponse = z.infer<typeof configGetResponseSchema>;
