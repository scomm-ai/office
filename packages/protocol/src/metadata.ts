import { z } from "zod";

export const scommMessageMetadataSchema = z.object({
  version: z.string().min(1),
  messageUid: z.string().min(1),
  schema: z.string().optional(),
  semantics: z.string().optional(),
  semanticDigest: z.string().optional(),
  classification: z.string().optional(),
  security: z.string().optional(),
});

export type ScommMessageMetadata = z.infer<typeof scommMessageMetadataSchema>;
