import { HeuristicSemanticExtractor, sha256SemanticDocument } from "@scomm-office/semantics";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditRepository, SemanticRepository } from "../repos/types.js";

const mailAddressSchema = z.object({
  displayName: z.string().optional(),
  emailAddress: z.string(),
});

const rawMailDocumentSchema = z.object({
  subject: z.string().optional(),
  plainText: z.string().optional(),
  html: z.string().optional(),
  from: mailAddressSchema.optional(),
  to: z.array(mailAddressSchema).optional(),
  cc: z.array(mailAddressSchema).optional(),
  bcc: z.array(mailAddressSchema).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        contentType: z.string().optional(),
        size: z.number().optional(),
        isInline: z.boolean().optional(),
      }),
    )
    .optional(),
  headers: z.record(z.string()).optional(),
});

const analyzeQuerySchema = z.object({
  persist: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((value) => value === "true" || value === "1"),
});

export async function registerSemanticRoutes(
  app: FastifyInstance,
  semantics: SemanticRepository,
  audit: AuditRepository,
): Promise<void> {
  const extractor = new HeuristicSemanticExtractor();

  app.post("/api/v1/semantics/analyze", async (request, reply) => {
    const parsedBody = rawMailDocumentSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: parsedBody.error.flatten() });
    }

    const query = analyzeQuerySchema.safeParse(request.query);
    const persist = query.success ? (query.data.persist ?? false) : false;

    const started = Date.now();
    const result = await extractor.extract({ document: parsedBody.data });
    const digest = await sha256SemanticDocument(result.document);

    if (persist) {
      await semantics.save(digest, result.document, digest);
    }

    await audit.append("semantic.analysis", {
      type: "semantic.analysis",
      timestamp: new Date().toISOString(),
      segmentCount: result.document.segments.length,
      durationMs: Date.now() - started,
      persisted: persist,
      digest,
    });

    return {
      document: result.document,
      digest,
      persisted: persist,
    };
  });
}
