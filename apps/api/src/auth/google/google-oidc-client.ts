import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { createOAuthCallbackError, isOAuthCallbackError } from "../errors.js";
import { createPkceCodeChallenge, type GoogleOAuthTransaction } from "./transaction.js";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleIdentity = {
  email: string;
  imageUrl: string | null;
  name: string | null;
  providerAccountId: string;
};

export type CompleteGoogleAuthorizationInput = Pick<
  GoogleOAuthTransaction,
  "codeVerifier" | "nonce"
> & {
  code: string;
};

export function createGoogleAuthorizationUrl(
  config: Pick<GoogleOAuthConfig, "clientId" | "redirectUri">,
  transaction: GoogleOAuthTransaction
): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);

  url.search = new URLSearchParams({
    client_id: config.clientId,
    code_challenge: createPkceCodeChallenge(transaction.codeVerifier),
    code_challenge_method: "S256",
    nonce: transaction.nonce,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: transaction.state
  }).toString();

  return url.toString();
}

export function createGoogleOidcClient(config: GoogleOAuthConfig) {
  return {
    async completeAuthorizationCode(
      input: CompleteGoogleAuthorizationInput
    ): Promise<GoogleIdentity> {
      const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: input.code,
          code_verifier: input.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri
        })
      });

      if (!tokenResponse.ok) {
        throw createOAuthCallbackError("Google rejected the authorization code.");
      }

      const tokenPayload: unknown = await tokenResponse.json();

      if (!isRecord(tokenPayload) || typeof tokenPayload.id_token !== "string") {
        throw createOAuthCallbackError("Google did not return an ID token.");
      }

      try {
        const { payload } = await jwtVerify(tokenPayload.id_token, GOOGLE_JWKS, {
          audience: config.clientId,
          issuer: GOOGLE_ISSUERS
        });

        return toGoogleIdentity(payload, input.nonce);
      } catch (error) {
        if (isOAuthCallbackError(error)) {
          throw error;
        }

        throw createOAuthCallbackError("Google returned an invalid ID token.");
      }
    }
  };
}

export type GoogleOidcClient = ReturnType<typeof createGoogleOidcClient>;

function toGoogleIdentity(payload: JWTPayload, expectedNonce: string): GoogleIdentity {
  if (payload.nonce !== expectedNonce) {
    throw createOAuthCallbackError("Google ID token nonce did not match the authorization request.");
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw createOAuthCallbackError("Google ID token did not contain a verified email identity.");
  }

  return {
    providerAccountId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : null,
    imageUrl: typeof payload.picture === "string" ? payload.picture : null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
