import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

import { createOAuthConfigurationError } from "./auth/errors.js";
import type { GoogleOAuthConfig } from "./auth/google/google-oidc-client.js";

config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true
});

const DEFAULT_PORT = 3001;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_SESSION_TTL_DAYS = 30;
const developmentCookieSecret = randomBytes(48).toString("base64url");
const developmentAccessTokenSecret = randomBytes(48).toString("base64url");
const developmentRefreshTokenPepper = randomBytes(48).toString("base64url");

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }

  return port;
}

export function getConfig() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    accessTokenSecret: readApplicationSecret(
      "ACCESS_TOKEN_SECRET",
      isProduction,
      developmentAccessTokenSecret
    ),
    accessTokenTtlSeconds: readPositiveInteger(
      "ACCESS_TOKEN_TTL_SECONDS",
      process.env.ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS
    ),
    host: process.env.API_HOST ?? "127.0.0.1",
    port: readPort(process.env.API_PORT),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    databaseUrl: process.env.DATABASE_URL,
    isProduction,
    oauthTransactionCookieSecret: readOAuthTransactionCookieSecret(isProduction),
    refreshTokenPepper: readApplicationSecret(
      "REFRESH_TOKEN_PEPPER",
      isProduction,
      developmentRefreshTokenPepper
    ),
    sessionTtlDays: readPositiveInteger(
      "SESSION_TTL_DAYS",
      process.env.SESSION_TTL_DAYS,
      DEFAULT_SESSION_TTL_DAYS
    ),
    getGoogleOAuthConfig: readGoogleOAuthConfig
  };
}

function readGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!isConfiguredValue(clientId) || !isConfiguredValue(clientSecret) || !isConfiguredValue(redirectUri)) {
    throw createOAuthConfigurationError();
  }

  return { clientId, clientSecret, redirectUri };
}

function readOAuthTransactionCookieSecret(isProduction: boolean): string {
  return readApplicationSecret(
    "OAUTH_TRANSACTION_COOKIE_SECRET",
    isProduction,
    developmentCookieSecret
  );
}

function readApplicationSecret(
  name: string,
  isProduction: boolean,
  developmentFallback: string
): string {
  const configuredSecret = process.env[name];

  if (isConfiguredValue(configuredSecret) && Buffer.byteLength(configuredSecret) >= 32) {
    return configuredSecret;
  }

  if (isProduction) {
    throw new Error(`${name} must contain at least 32 bytes in production.`);
  }

  return developmentFallback;
}

function readPositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsedValue;
}

function isConfiguredValue(value: string | undefined): value is string {
  return Boolean(value && !value.startsWith("replace-with-"));
}
