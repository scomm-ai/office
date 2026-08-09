import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "./env.js";

const PUBLIC_PATHS = new Set(["/health", "/ready", "/version"]);

function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim();
}

export function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return PUBLIC_PATHS.has(path);
}

export function createAuthHook(config: ServerConfig) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const path = request.url.split("?")[0] ?? request.url;
    if (isPublicPath(path) || !path.startsWith("/api/v1/")) {
      return;
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      await reply.code(401).send({ error: "Missing authorization token" });
      return;
    }

    if (token !== config.devToken) {
      await reply.code(403).send({ error: "Invalid authorization token" });
      return;
    }
  };
}

export type ScommAuthProvider = ReturnType<typeof createAuthHook>;
