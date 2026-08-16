import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { createRequireAuthentication } from "./auth/authentication-middleware.js";
import {
  createOAuthConfigurationError,
  isAccountLinkRequiredError,
  isOAuthCallbackError,
  isOAuthConfigurationError
} from "./auth/errors.js";
import {
  createGoogleAuthorizationUrl,
  type CompleteGoogleAuthorizationInput,
  type GoogleOAuthConfig
} from "./auth/google/google-oidc-client.js";
import {
  createGoogleOAuthTransaction,
  deserializeGoogleOAuthTransaction,
  isValidGoogleOAuthCallback,
  serializeGoogleOAuthTransaction
} from "./auth/google/transaction.js";
import {
  createGitHubAuthorizationUrl,
  type CompleteGitHubAuthorizationInput,
  type GitHubOAuthConfig
} from "./auth/github/github-oauth-client.js";
import {
  createGitHubOAuthTransaction,
  deserializeGitHubOAuthTransaction,
  isValidGitHubOAuthCallback,
  serializeGitHubOAuthTransaction
} from "./auth/github/transaction.js";
import { type OAuthIdentityService } from "./auth/oauth-identity-service.js";
import {
  getClearRefreshTokenCookieOptions,
  getRefreshTokenCookieOptions,
  REFRESH_TOKEN_COOKIE
} from "./auth/session/refresh-token-cookie.js";
import {
  type AuthenticatedSession,
  type RefreshTokenRotation,
  type SessionLifecycle,
  type SessionUser
} from "./auth/session/session-lifecycle-service.js";
import { type SessionManagement } from "./auth/session/session-management-service.js";
import { getConfig } from "./config.js";

const GOOGLE_OAUTH_TRANSACTION_COOKIE = "oauth_google_transaction";
const GITHUB_OAUTH_TRANSACTION_COOKIE = "oauth_github_transaction";
const OAUTH_TRANSACTION_COOKIE_MAX_AGE_SECONDS = 10 * 60;

type GoogleSignIn = {
  complete(input: CompleteGoogleAuthorizationInput): Promise<SessionUser>;
};

type GitHubSignIn = {
  complete(input: CompleteGitHubAuthorizationInput): Promise<SessionUser>;
  link(userId: string, input: CompleteGitHubAuthorizationInput): Promise<SessionUser>;
};

type SessionAuth = Pick<
  SessionLifecycle,
  "authenticateAccessToken" | "createSession" | "logout" | "rotateRefreshToken"
>;

type SessionManager = Pick<
  SessionManagement,
  "listActiveSessions" | "revokeAllSessionsForUser" | "revokeSessionForUser"
>;

type AccountLinking = Pick<OAuthIdentityService, "listLinkedAccounts">;

type CreateAppOptions = {
  accountLinking?: AccountLinking;
  completeGitHubSignIn?: GitHubSignIn;
  completeGoogleSignIn?: GoogleSignIn;
  getGitHubOAuthConfig?: () => GitHubOAuthConfig;
  getGoogleOAuthConfig?: () => GoogleOAuthConfig;
  logger?: boolean;
  oauthTransactionCookieSecret?: string;
  secureCookies?: boolean;
  sessionLifecycle?: SessionAuth;
  sessionManagement?: SessionManager;
  webOrigin?: string;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const config = getConfig();
  const webOrigin = options.webOrigin ?? config.webOrigin;
  const cookieSecret = options.oauthTransactionCookieSecret ?? config.oauthTransactionCookieSecret;
  const secureCookies = options.secureCookies ?? config.isProduction;
  const getGitHubOAuthConfig = options.getGitHubOAuthConfig ?? config.getGitHubOAuthConfig;
  const getGoogleOAuthConfig = options.getGoogleOAuthConfig ?? config.getGoogleOAuthConfig;

  app.register(cookie, { secret: cookieSecret });
  app.decorateRequest("auth", null);

  app.register(cors, {
    origin: webOrigin,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"]
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status", "service"],
            properties: {
              status: { type: "string" },
              service: { type: "string" }
            }
          }
        }
      }
    },
    async () => ({ status: "ok", service: "api" })
  );

  registerGoogleAuthRoutes(app, {
    completeGoogleSignIn: options.completeGoogleSignIn,
    getGoogleOAuthConfig,
    secureCookies,
    sessionLifecycle: options.sessionLifecycle,
    webOrigin
  });
  registerGitHubAuthRoutes(app, {
    completeGitHubSignIn: options.completeGitHubSignIn,
    getGitHubOAuthConfig,
    secureCookies,
    sessionLifecycle: options.sessionLifecycle,
    webOrigin
  });
  registerSessionAuthRoutes(app, {
    accountLinking: options.accountLinking,
    secureCookies,
    sessionLifecycle: options.sessionLifecycle,
    sessionManagement: options.sessionManagement,
    webOrigin
  });

  return app;
}

type GoogleAuthRoutesOptions = {
  completeGoogleSignIn?: GoogleSignIn;
  getGoogleOAuthConfig: () => GoogleOAuthConfig;
  secureCookies: boolean;
  sessionLifecycle?: SessionLifecycle;
  webOrigin: string;
};

function registerGoogleAuthRoutes(app: FastifyInstance, options: GoogleAuthRoutesOptions) {
  app.get("/auth/google", async (_request, reply) => {
    const auth = getGoogleAuthDependencies(options);

    if (!auth) {
      return reply.code(503).send({ error: "Google sign-in is not configured." });
    }

    const transaction = createGoogleOAuthTransaction();

    reply.setCookie(
      GOOGLE_OAUTH_TRANSACTION_COOKIE,
      serializeGoogleOAuthTransaction(transaction),
      getOAuthTransactionCookieOptions(options.secureCookies, "/auth/google")
    );

    return reply.redirect(createGoogleAuthorizationUrl(auth.config, transaction));
  });

  app.get<{
    Querystring: { code?: string; error?: string; state?: string };
  }>("/auth/google/callback", async (request, reply) => {
    const auth = getGoogleAuthDependencies(options);

    if (!auth) {
      return reply.code(503).send({ error: "Google sign-in is not configured." });
    }

    reply.clearCookie(GOOGLE_OAUTH_TRANSACTION_COOKIE, {
      httpOnly: true,
      path: "/auth/google",
      sameSite: "lax",
      secure: options.secureCookies
    });

    if (request.query.error) {
      return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "google-denied"));
    }

    if (typeof request.query.code !== "string" || typeof request.query.state !== "string") {
      return reply.code(400).send({ error: "Google OAuth callback is missing required parameters." });
    }

    const transaction = readGoogleOAuthTransaction(
      request.cookies[GOOGLE_OAUTH_TRANSACTION_COOKIE],
      reply
    );

    if (!transaction || !isValidGoogleOAuthCallback(transaction, request.query.state)) {
      return reply.code(400).send({ error: "Google OAuth state validation failed." });
    }

    try {
      if (!options.sessionLifecycle) {
        return reply.code(503).send({ error: "Session storage is not configured." });
      }

      const user = await auth.completeGoogleSignIn.complete({
        code: request.query.code,
        codeVerifier: transaction.codeVerifier,
        nonce: transaction.nonce
      });
      const session = await options.sessionLifecycle.createSession(user, {
        ipAddress: request.ip,
        userAgent: readUserAgent(request)
      });

      reply.setCookie(
        REFRESH_TOKEN_COOKIE,
        session.refreshToken,
        getRefreshTokenCookieOptions({
          maxAge: getRemainingLifetimeInSeconds(session.expiresAt),
          secure: options.secureCookies
        })
      );

      return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "google-complete"));
    } catch (error) {
      if (isAccountLinkRequiredError(error)) {
        return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "google-link-required"));
      }

      if (isOAuthCallbackError(error)) {
        request.log.warn({ error: error.message }, "Google OAuth callback rejected");
        return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "google-failed"));
      }

      request.log.error(error, "Google OAuth callback failed");
      return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "google-failed"));
    }
  });
}

function getGoogleAuthDependencies(options: GoogleAuthRoutesOptions) {
  try {
    if (!options.completeGoogleSignIn) {
      throw createOAuthConfigurationError();
    }

    return {
      config: options.getGoogleOAuthConfig(),
      completeGoogleSignIn: options.completeGoogleSignIn
    };
  } catch (error) {
    if (isOAuthConfigurationError(error)) {
      return null;
    }

    throw error;
  }
}

type GitHubAuthRoutesOptions = {
  completeGitHubSignIn?: GitHubSignIn;
  getGitHubOAuthConfig: () => GitHubOAuthConfig;
  secureCookies: boolean;
  sessionLifecycle?: SessionAuth;
  webOrigin: string;
};

function registerGitHubAuthRoutes(app: FastifyInstance, options: GitHubAuthRoutesOptions) {
  app.get("/auth/github", async (_request, reply) => {
    const auth = getGitHubAuthDependencies(options);

    if (!auth) {
      return reply.code(503).send({ error: "GitHub sign-in is not configured." });
    }

    const transaction = createGitHubOAuthTransaction();

    reply.setCookie(
      GITHUB_OAUTH_TRANSACTION_COOKIE,
      serializeGitHubOAuthTransaction(transaction),
      getOAuthTransactionCookieOptions(options.secureCookies, "/auth/github")
    );

    return reply.redirect(createGitHubAuthorizationUrl(auth.config, transaction));
  });

  if (!options.sessionLifecycle) {
    app.post("/auth/github/link", async (_request, reply) => {
      return reply.code(503).send({ error: "Session storage is not configured." });
    });
  } else {
    const requireAuthentication = createRequireAuthentication(options.sessionLifecycle);

    app.post("/auth/github/link", { preHandler: requireAuthentication }, async (request, reply) => {
      const auth = getGitHubAuthDependencies(options);

      if (!auth) {
        return reply.code(503).send({ error: "GitHub sign-in is not configured." });
      }

      if (!hasTrustedOrigin(request, options.webOrigin)) {
        return reply.code(403).send({ error: "The request origin is not allowed." });
      }

      if (!request.auth) {
        return reply.code(401).send({ error: "The access token is invalid or the session is no longer active." });
      }

      const transaction = createGitHubOAuthTransaction({ userId: request.auth.user.id });

      reply.setCookie(
        GITHUB_OAUTH_TRANSACTION_COOKIE,
        serializeGitHubOAuthTransaction(transaction),
        getOAuthTransactionCookieOptions(options.secureCookies, "/auth/github")
      );

      return { authorizationUrl: createGitHubAuthorizationUrl(auth.config, transaction) };
    });
  }

  app.get<{
    Querystring: { code?: string; error?: string; state?: string };
  }>("/auth/github/callback", async (request, reply) => {
    const auth = getGitHubAuthDependencies(options);

    if (!auth) {
      return reply.code(503).send({ error: "GitHub sign-in is not configured." });
    }

    const transaction = readGitHubOAuthTransaction(
      request.cookies[GITHUB_OAUTH_TRANSACTION_COOKIE],
      reply
    );

    reply.clearCookie(GITHUB_OAUTH_TRANSACTION_COOKIE, {
      httpOnly: true,
      path: "/auth/github",
      sameSite: "lax",
      secure: options.secureCookies
    });

    if (request.query.error) {
      return reply.redirect(
        createWebOAuthResultUrl(
          options.webOrigin,
          transaction?.intent === "link" ? "github-link-denied" : "github-denied"
        )
      );
    }

    if (typeof request.query.code !== "string" || typeof request.query.state !== "string") {
      return reply.code(400).send({ error: "GitHub OAuth callback is missing required parameters." });
    }

    if (!transaction || !isValidGitHubOAuthCallback(transaction, request.query.state)) {
      return reply.code(400).send({ error: "GitHub OAuth state validation failed." });
    }

    try {
      const authorization = { code: request.query.code, codeVerifier: transaction.codeVerifier };

      if (transaction.intent === "link") {
        await auth.completeGitHubSignIn.link(transaction.userId, authorization);
        return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "github-linked"));
      }

      if (!options.sessionLifecycle) {
        return reply.code(503).send({ error: "Session storage is not configured." });
      }

      const user = await auth.completeGitHubSignIn.complete(authorization);
      const session = await options.sessionLifecycle.createSession(user, {
        ipAddress: request.ip,
        userAgent: readUserAgent(request)
      });

      reply.setCookie(
        REFRESH_TOKEN_COOKIE,
        session.refreshToken,
        getRefreshTokenCookieOptions({
          maxAge: getRemainingLifetimeInSeconds(session.expiresAt),
          secure: options.secureCookies
        })
      );

      return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "github-complete"));
    } catch (error) {
      if (isAccountLinkRequiredError(error)) {
        return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "github-link-required"));
      }

      if (isOAuthCallbackError(error)) {
        request.log.warn({ error: error.message }, "GitHub OAuth callback rejected");
      } else {
        request.log.error(error, "GitHub OAuth callback failed");
      }

      return reply.redirect(
        createWebOAuthResultUrl(
          options.webOrigin,
          transaction.intent === "link" ? "github-link-failed" : "github-failed"
        )
      );
    }
  });
}

function getGitHubAuthDependencies(options: GitHubAuthRoutesOptions) {
  try {
    if (!options.completeGitHubSignIn) {
      throw createOAuthConfigurationError("GitHub");
    }

    return {
      config: options.getGitHubOAuthConfig(),
      completeGitHubSignIn: options.completeGitHubSignIn
    };
  } catch (error) {
    if (isOAuthConfigurationError(error)) {
      return null;
    }

    throw error;
  }
}

type SessionAuthRoutesOptions = {
  accountLinking?: AccountLinking;
  secureCookies: boolean;
  sessionLifecycle?: SessionAuth;
  sessionManagement?: SessionManager;
  webOrigin: string;
};

function registerSessionAuthRoutes(app: FastifyInstance, options: SessionAuthRoutesOptions) {
  if (!options.sessionLifecycle) {
    app.post("/auth/refresh", async (_request, reply) => {
      return reply.code(503).send({ error: "Session storage is not configured." });
    });
    app.post("/auth/logout", async (_request, reply) => {
      return reply.code(503).send({ error: "Session storage is not configured." });
    });
    app.get("/auth/me", async (_request, reply) => {
      return reply.code(503).send({ error: "Session storage is not configured." });
    });
    app.get("/accounts", async (_request, reply) => {
      return reply.code(503).send({ error: "Session storage is not configured." });
    });
    return;
  }

  const sessionLifecycle = options.sessionLifecycle;
  const requireAuthentication = createRequireAuthentication(sessionLifecycle);

  app.post("/auth/refresh", async (request, reply) => {
    if (!hasTrustedOrigin(request, options.webOrigin)) {
      return reply.code(403).send({ error: "The request origin is not allowed." });
    }

    const rotation = await sessionLifecycle.rotateRefreshToken(
      request.cookies[REFRESH_TOKEN_COOKIE]
    );

    if (rotation.kind === "invalid") {
      reply.clearCookie(REFRESH_TOKEN_COOKIE, getClearRefreshTokenCookieOptions(options.secureCookies));
      return reply.code(401).send({ error: "The refresh token is invalid or expired." });
    }

    setRefreshTokenCookie(reply, rotation, options.secureCookies);
    return {
      accessToken: rotation.accessToken,
      expiresIn: getRemainingLifetimeInSeconds(rotation.accessTokenExpiresAt),
      tokenType: "Bearer"
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    if (!hasTrustedOrigin(request, options.webOrigin)) {
      return reply.code(403).send({ error: "The request origin is not allowed." });
    }

    await sessionLifecycle.logout(request.cookies[REFRESH_TOKEN_COOKIE]);
    reply.clearCookie(REFRESH_TOKEN_COOKIE, getClearRefreshTokenCookieOptions(options.secureCookies));
    return reply.code(204).send();
  });

  app.get(
    "/auth/me",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      if (!request.auth) {
        return reply.code(401).send({ error: "The access token is invalid or the session is no longer active." });
      }

      return toAuthMeResponse(request.auth);
    }
  );

  app.get("/accounts", { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.auth) {
      return reply.code(401).send({ error: "The access token is invalid or the session is no longer active." });
    }

    if (!options.accountLinking) {
      return reply.code(503).send({ error: "Account linking is not configured." });
    }

    return { accounts: await options.accountLinking.listLinkedAccounts(request.auth.user.id) };
  });

  registerSessionManagementRoutes(app, {
    requireAuthentication,
    secureCookies: options.secureCookies,
    sessionManagement: options.sessionManagement
  });
}

type SessionManagementRoutesOptions = {
  requireAuthentication: ReturnType<typeof createRequireAuthentication>;
  secureCookies: boolean;
  sessionManagement?: SessionManager;
};

function registerSessionManagementRoutes(
  app: FastifyInstance,
  options: SessionManagementRoutesOptions
) {
  if (!options.sessionManagement) {
    app.get("/sessions", async (_request, reply) => {
      return reply.code(503).send({ error: "Session management is not configured." });
    });
    app.delete<{ Params: { id: string } }>("/sessions/:id", async (_request, reply) => {
      return reply.code(503).send({ error: "Session management is not configured." });
    });
    app.delete("/sessions", async (_request, reply) => {
      return reply.code(503).send({ error: "Session management is not configured." });
    });
    return;
  }

  const sessionManagement = options.sessionManagement;

  app.get("/sessions", { preHandler: options.requireAuthentication }, async (request, reply) => {
    const auth = request.auth;

    if (!auth) {
      return reply.code(401).send({ error: "The access token is invalid or the session is no longer active." });
    }

    return {
      sessions: await sessionManagement.listActiveSessions(auth.user.id, auth.sessionId)
    };
  });

  app.delete<{ Params: { id: string } }>(
    "/sessions/:id",
    { preHandler: options.requireAuthentication },
    async (request, reply) => {
      const auth = request.auth;

      if (!auth) {
        return reply.code(401).send({ error: "The access token is invalid or the session is no longer active." });
      }

      const revoked = await sessionManagement.revokeSessionForUser(request.params.id, auth.user.id);

      if (!revoked) {
        return reply.code(404).send({ error: "The session was not found or is no longer active." });
      }

      if (request.params.id === auth.sessionId) {
        reply.clearCookie(REFRESH_TOKEN_COOKIE, getClearRefreshTokenCookieOptions(options.secureCookies));
      }

      return reply.code(204).send();
    }
  );

  app.delete("/sessions", { preHandler: options.requireAuthentication }, async (request, reply) => {
    const auth = request.auth;

    if (!auth) {
      return reply.code(401).send({ error: "The access token is invalid or the session is no longer active." });
    }

    await sessionManagement.revokeAllSessionsForUser(auth.user.id);
    reply.clearCookie(REFRESH_TOKEN_COOKIE, getClearRefreshTokenCookieOptions(options.secureCookies));
    return reply.code(204).send();
  });
}

function getOAuthTransactionCookieOptions(secure: boolean, path: string) {
  return {
    httpOnly: true,
    maxAge: OAUTH_TRANSACTION_COOKIE_MAX_AGE_SECONDS,
    path,
    sameSite: "lax" as const,
    secure,
    signed: true
  };
}

function readGoogleOAuthTransaction(cookieValue: string | undefined, reply: FastifyReply) {
  if (!cookieValue) {
    return null;
  }

  const unsignedCookie = reply.unsignCookie(cookieValue);

  if (!unsignedCookie.valid) {
    return null;
  }

  return deserializeGoogleOAuthTransaction(unsignedCookie.value);
}

function readGitHubOAuthTransaction(cookieValue: string | undefined, reply: FastifyReply) {
  if (!cookieValue) {
    return null;
  }

  const unsignedCookie = reply.unsignCookie(cookieValue);

  if (!unsignedCookie.valid) {
    return null;
  }

  return deserializeGitHubOAuthTransaction(unsignedCookie.value);
}

function createWebOAuthResultUrl(webOrigin: string, status: string): string {
  const url = new URL(webOrigin);
  url.searchParams.set("oauth", status);

  return url.toString();
}

function getRemainingLifetimeInSeconds(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

function hasTrustedOrigin(request: FastifyRequest, webOrigin: string): boolean {
  const origin = request.headers.origin;

  return origin === undefined || origin === webOrigin;
}

function readUserAgent(request: FastifyRequest): string | undefined {
  const userAgent = request.headers["user-agent"];

  return typeof userAgent === "string" ? userAgent : undefined;
}

function setRefreshTokenCookie(
  reply: FastifyReply,
  rotation: Extract<RefreshTokenRotation, { kind: "rotated" }>,
  secureCookies: boolean
) {
  reply.setCookie(
    REFRESH_TOKEN_COOKIE,
    rotation.refreshToken,
    getRefreshTokenCookieOptions({
      maxAge: getRemainingLifetimeInSeconds(rotation.expiresAt),
      secure: secureCookies
    })
  );
}

function toAuthMeResponse(auth: AuthenticatedSession) {
  return {
    session: { expiresAt: auth.sessionExpiresAt, id: auth.sessionId },
    user: auth.user
  };
}
