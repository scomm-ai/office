import { normalizeEmail } from "@scomm-office/core";
import { identityTypeSchema, pubkeyPutRequestSchema } from "@scomm-office/protocol";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditRepository, PublicKeyRepository } from "../repos/types.js";
import { assertNoPrivateKeyMaterial, decodePathSegment } from "./utils.js";

const revokeRequestSchema = z.object({
  reason: z.string().optional(),
});

function identitiesMatch(type: string, pathValue: string, bodyValue: string): boolean {
  if (type === "email") {
    return normalizeEmail(pathValue) === normalizeEmail(bodyValue);
  }
  return pathValue.trim() === bodyValue.trim();
}

export async function registerPubkeyRoutes(
  app: FastifyInstance,
  publicKeys: PublicKeyRepository,
  audit: AuditRepository,
): Promise<void> {
  app.get("/api/v1/identities/:identityType/:identity/keys", async (request) => {
    const params = request.params as { identityType: string; identity: string };
    const identityType = identityTypeSchema.parse(decodePathSegment(params.identityType));
    const identity = decodePathSegment(params.identity);

    const keys = await publicKeys.listKeys(identityType, identity);
    await audit.append("pubkey.lookup", {
      type: "pubkey.lookup",
      timestamp: new Date().toISOString(),
      identityType,
      resultCount: keys.length,
    });

    return { keys };
  });

  app.get("/api/v1/identities/:identityType/:identity/keys/:keyId", async (request, reply) => {
    const params = request.params as { identityType: string; identity: string; keyId: string };
    const identityType = identityTypeSchema.parse(decodePathSegment(params.identityType));
    const identity = decodePathSegment(params.identity);
    const keyId = decodePathSegment(params.keyId);

    const key = await publicKeys.getKey(identityType, identity, keyId);
    if (!key) {
      return reply.code(404).send({ error: "Public key not found" });
    }

    return { key };
  });

  app.put("/api/v1/identities/:identityType/:identity/keys/:keyId", async (request, reply) => {
    const params = request.params as { identityType: string; identity: string; keyId: string };
    const identityType = identityTypeSchema.parse(decodePathSegment(params.identityType));
    const identity = decodePathSegment(params.identity);
    const keyId = decodePathSegment(params.keyId);

    try {
      assertNoPrivateKeyMaterial(request.body);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid request body",
      });
    }

    const parsed = pubkeyPutRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    if (
      parsed.data.identity.type !== identityType ||
      !identitiesMatch(identityType, identity, parsed.data.identity.value)
    ) {
      return reply.code(400).send({ error: "Identity in body must match URL path" });
    }

    if (parsed.data.keyId !== keyId) {
      return reply.code(400).send({ error: "keyId in body must match URL path" });
    }

    const key = await publicKeys.upsertKey(parsed.data);
    await audit.append("pubkey.publish", {
      type: "pubkey.publish",
      timestamp: new Date().toISOString(),
      identityType,
      keyId: key.keyId,
    });

    return { key };
  });

  app.post(
    "/api/v1/identities/:identityType/:identity/keys/:keyId/revoke",
    async (request, reply) => {
      const params = request.params as { identityType: string; identity: string; keyId: string };
      const identityType = identityTypeSchema.parse(decodePathSegment(params.identityType));
      const identity = decodePathSegment(params.identity);
      const keyId = decodePathSegment(params.keyId);
      const body = revokeRequestSchema.safeParse(request.body ?? {});
      const reason = body.success ? body.data.reason : undefined;

      const key = await publicKeys.revokeKey(identityType, identity, keyId, reason);
      if (!key) {
        return reply.code(404).send({ error: "Public key not found" });
      }

      await audit.append("pubkey.publish", {
        type: "pubkey.publish",
        timestamp: new Date().toISOString(),
        identityType,
        keyId,
        action: "revoke",
        ...(reason !== undefined ? { reason } : {}),
      });

      return { key };
    },
  );
}
