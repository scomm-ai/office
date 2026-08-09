import { DeterministicPolicyEngine } from "@scomm-office/policy";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditRepository, PolicyRepository } from "../repos/types.js";

const policyDocumentSchema = z.object({
  version: z.string(),
  segments: z.array(
    z.object({
      type: z.string(),
      content: z.string(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  entities: z.array(
    z.object({
      type: z.string(),
      value: z.string(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  actions: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  classification: z
    .object({
      label: z.string(),
      sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .optional(),
  metadata: z.record(z.unknown()).default({}),
});

const keywordPolicySchema = z.object({
  keywords: z.array(z.string()),
  action: z.enum(["warn", "block"]),
  caseSensitive: z.boolean().optional(),
});

const evaluateRequestSchema = z.object({
  document: policyDocumentSchema,
  recipients: z.array(z.string()),
  internalDomains: z.array(z.string()).default([]),
  attachmentCount: z.number().int().nonnegative().optional(),
  classificationRequired: z.boolean().optional(),
  keywordPolicy: keywordPolicySchema.optional(),
});

export async function registerPolicyRoutes(
  app: FastifyInstance,
  policyRepo: PolicyRepository,
  audit: AuditRepository,
): Promise<void> {
  app.get("/api/v1/policies", async () => {
    const rules = policyRepo.listRules();
    return {
      rules: rules.map((rule) => ({
        id: rule.id,
      })),
    };
  });

  app.post("/api/v1/policies/evaluate", async (request, reply) => {
    const parsed = evaluateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const started = Date.now();
    const engine = new DeterministicPolicyEngine(policyRepo.listRules());
    const evaluation = engine.evaluate(parsed.data);

    await audit.append("policy.evaluation", {
      type: "policy.evaluation",
      timestamp: new Date().toISOString(),
      allowed: evaluation.allowed,
      findingCount: evaluation.findings.length,
      durationMs: Date.now() - started,
    });

    return evaluation;
  });
}
