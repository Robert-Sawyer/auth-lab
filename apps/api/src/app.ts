import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

import { AccountLinkRequiredError, OAuthCallbackError, OAuthConfigurationError } from "./auth/errors.js";
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
import { getConfig } from "./config.js";

const GOOGLE_OAUTH_TRANSACTION_COOKIE = "oauth_google_transaction";
const OAUTH_TRANSACTION_COOKIE_MAX_AGE_SECONDS = 10 * 60;

type GoogleSignIn = {
  complete(input: CompleteGoogleAuthorizationInput): Promise<unknown>;
};

type CreateAppOptions = {
  completeGoogleSignIn?: GoogleSignIn;
  getGoogleOAuthConfig?: () => GoogleOAuthConfig;
  logger?: boolean;
  oauthTransactionCookieSecret?: string;
  secureCookies?: boolean;
  webOrigin?: string;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const config = getConfig();
  const webOrigin = options.webOrigin ?? config.webOrigin;
  const cookieSecret = options.oauthTransactionCookieSecret ?? config.oauthTransactionCookieSecret;
  const secureCookies = options.secureCookies ?? config.isProduction;
  const getGoogleOAuthConfig = options.getGoogleOAuthConfig ?? config.getGoogleOAuthConfig;

  app.register(cookie, { secret: cookieSecret });

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
    webOrigin
  });

  return app;
}

type GoogleAuthRoutesOptions = {
  completeGoogleSignIn?: GoogleSignIn;
  getGoogleOAuthConfig: () => GoogleOAuthConfig;
  secureCookies: boolean;
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
      getOAuthTransactionCookieOptions(options.secureCookies)
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
      await auth.completeGoogleSignIn.complete({
        code: request.query.code,
        codeVerifier: transaction.codeVerifier,
        nonce: transaction.nonce
      });

      // Session tokens are deliberately introduced in the next stage.
      return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "google-complete"));
    } catch (error) {
      if (error instanceof AccountLinkRequiredError) {
        return reply.redirect(createWebOAuthResultUrl(options.webOrigin, "account-link-required"));
      }

      if (error instanceof OAuthCallbackError) {
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
      throw new OAuthConfigurationError();
    }

    return {
      config: options.getGoogleOAuthConfig(),
      completeGoogleSignIn: options.completeGoogleSignIn
    };
  } catch (error) {
    if (error instanceof OAuthConfigurationError) {
      return null;
    }

    throw error;
  }
}

function getOAuthTransactionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: OAUTH_TRANSACTION_COOKIE_MAX_AGE_SECONDS,
    path: "/auth/google",
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

function createWebOAuthResultUrl(webOrigin: string, status: string): string {
  const url = new URL(webOrigin);
  url.searchParams.set("oauth", status);

  return url.toString();
}
