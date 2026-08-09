import type { FastifyInstance } from "fastify";
import { redactAuditPayload } from "../repos/audit-repo.js";
import type { AuditRepository } from "../repos/types.js";

export async function registerAuditRoutes(
  app: FastifyInstance,
  audit: AuditRepository,
): Promise<void> {
  app.get("/api/v1/audit", async (request) => {
    const limitRaw = (request.query as { limit?: string }).limit;
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

    const events = await audit.listRecent(limit);
    return {
      events: events.map((event) => ({
        id: event.id,
        event: event.event,
        payload: redactAuditPayload(event.payload),
        createdAt: event.createdAt,
      })),
    };
  });
}
