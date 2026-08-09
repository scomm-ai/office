import { z } from "zod";

export const keyTrustSchema = z.enum([
  "unknown",
  "directory-asserted",
  "verified",
  "organization-verified",
  "user-verified",
]);

export type KeyTrust = z.infer<typeof keyTrustSchema>;

export const keyStateSchema = z.enum([
  "created",
  "active",
  "revoked",
  "expired",
  "superseded",
]);

export type KeyState = z.infer<typeof keyStateSchema>;

export const identityTypeSchema = z.enum(["email", "scomm-uid", "other"]);

export type IdentityType = z.infer<typeof identityTypeSchema>;

export const publicKeyIdentitySchema = z.object({
  type: identityTypeSchema,
  value: z.string().min(1),
});

export type PublicKeyIdentity = z.infer<typeof publicKeyIdentitySchema>;

export const publicKeyAlgorithmSchema = z.union([
  z.literal("Ed25519"),
  z.literal("X25519"),
  z.string().min(1),
]);

export type PublicKeyAlgorithm = z.infer<typeof publicKeyAlgorithmSchema>;

export const publicKeyEncodingSchema = z.enum(["base64url", "jwk"]);

export type PublicKeyEncoding = z.infer<typeof publicKeyEncodingSchema>;

export const publicKeyPurposeSchema = z.enum([
  "signing",
  "encryption",
  "authentication",
]);

export type PublicKeyPurpose = z.infer<typeof publicKeyPurposeSchema>;

export const publicKeyRecordSchema = z.object({
  version: z.literal(1),
  identity: publicKeyIdentitySchema,
  keyId: z.string().min(1),
  algorithm: publicKeyAlgorithmSchema,
  publicKey: z.string().min(1),
  encoding: publicKeyEncodingSchema,
  purpose: publicKeyPurposeSchema,
  state: keyStateSchema.optional(),
  trust: keyTrustSchema.optional(),
  createdAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type PublicKeyRecord = z.infer<typeof publicKeyRecordSchema>;
