import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthenticatedSession, SessionLifecycle } from "./session/session-lifecycle-service.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthenticatedSession | null;
  }
}

export type AuthenticationMiddleware = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function createRequireAuthentication(
  sessionLifecycle: Pick<SessionLifecycle, "authenticateAccessToken">
): AuthenticationMiddleware {
  return async (request, reply) => {
    const accessToken = readBearerToken(request.headers.authorization);

    if (!accessToken) {
      return reply.code(401).send({ error: "A Bearer access token is required." });
    }

    const auth = await sessionLifecycle.authenticateAccessToken(accessToken);

    if (!auth) {
      return reply.code(401).send({ error: "The access token is invalid or the session is no longer active." });
    }

    request.auth = auth;
  };
}

function readBearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");

  return match?.[1] ?? null;
}
