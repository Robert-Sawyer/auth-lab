import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

import { OAuthConfigurationError } from "./auth/errors.js";
import type { GoogleOAuthConfig } from "./auth/google/google-oidc-client.js";

config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true
});

const DEFAULT_PORT = 3001;
const developmentCookieSecret = randomBytes(48).toString("base64url");

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
    host: process.env.API_HOST ?? "127.0.0.1",
    port: readPort(process.env.API_PORT),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    databaseUrl: process.env.DATABASE_URL,
    isProduction,
    oauthTransactionCookieSecret: readOAuthTransactionCookieSecret(isProduction),
    getGoogleOAuthConfig: readGoogleOAuthConfig
  };
}

function readGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!isConfiguredValue(clientId) || !isConfiguredValue(clientSecret) || !isConfiguredValue(redirectUri)) {
    throw new OAuthConfigurationError();
  }

  return { clientId, clientSecret, redirectUri };
}

function readOAuthTransactionCookieSecret(isProduction: boolean): string {
  const configuredSecret = process.env.OAUTH_TRANSACTION_COOKIE_SECRET;

  if (isConfiguredValue(configuredSecret) && Buffer.byteLength(configuredSecret) >= 32) {
    return configuredSecret;
  }

  if (isProduction) {
    throw new Error("OAUTH_TRANSACTION_COOKIE_SECRET must contain at least 32 bytes in production.");
  }

  return developmentCookieSecret;
}

function isConfiguredValue(value: string | undefined): value is string {
  return Boolean(value && !value.startsWith("replace-with-"));
}
