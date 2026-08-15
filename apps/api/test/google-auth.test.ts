import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { CompleteGoogleAuthorizationInput } from "../src/auth/google/google-oidc-client.js";
import { createPkceCodeChallenge, deserializeGoogleOAuthTransaction } from "../src/auth/google/transaction.js";
import type { SessionUser } from "../src/auth/session/session-lifecycle-service.js";

type CompleteGoogleSignIn = (input: CompleteGoogleAuthorizationInput) => Promise<SessionUser>;
type CookieHeaders = Record<string, string | string[] | number | undefined>;

const googleConfig = {
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  redirectUri: "http://localhost:3001/auth/google/callback"
};

describe("Google OAuth routes", () => {
  const apps = new Set<ReturnType<typeof createApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  it("starts Authorization Code Flow with state, PKCE, nonce, and a signed transaction cookie", async () => {
    const complete = vi.fn<CompleteGoogleSignIn>();
    const app = createGoogleTestApp(complete);
    apps.add(app);

    const response = await app.inject({ method: "GET", url: "/auth/google" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBeDefined();

    const authorizationUrl = new URL(response.headers.location as string);
    const transaction = readTransaction(app, getCookieHeader(response));

    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.pathname).toBe("/o/oauth2/v2/auth");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(googleConfig.clientId);
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      createPkceCodeChallenge(transaction.codeVerifier)
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("nonce")).toBe(transaction.nonce);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(googleConfig.redirectUri);
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(authorizationUrl.searchParams.get("state")).toBe(transaction.state);

    expect(getCookieHeader(response)).toContain("HttpOnly");
    expect(getCookieHeader(response)).toContain("Path=/auth/google");
    expect(getCookieHeader(response)).toContain("SameSite=Lax");
    expect(complete).not.toHaveBeenCalled();
  });

  it("accepts only the matching state and then clears the one-time transaction cookie", async () => {
    const complete = vi.fn<CompleteGoogleSignIn>().mockResolvedValue(testUser);
    const app = createGoogleTestApp(complete);
    apps.add(app);

    const start = await app.inject({ method: "GET", url: "/auth/google" });
    const transaction = readTransaction(app, getCookieHeader(start));
    const callback = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=authorization-code&state=${transaction.state}`,
      headers: { cookie: getCookiePair(start) }
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:3000/?oauth=google-complete");
    expect(getCookieHeaders(callback)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("oauth_google_transaction=;"),
        expect.stringContaining("refresh_token="),
        expect.stringContaining("HttpOnly"),
        expect.stringContaining("Path=/auth"),
        expect.stringContaining("SameSite=Lax")
      ])
    );
    expect(complete).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier: transaction.codeVerifier,
      nonce: transaction.nonce
    });
  });

  it("rejects callbacks with a mismatched state before exchanging the authorization code", async () => {
    const complete = vi.fn<CompleteGoogleSignIn>();
    const app = createGoogleTestApp(complete);
    apps.add(app);

    const start = await app.inject({ method: "GET", url: "/auth/google" });
    const callback = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=authorization-code&state=attacker-state",
      headers: { cookie: getCookiePair(start) }
    });

    expect(callback.statusCode).toBe(400);
    expect(callback.json()).toEqual({ error: "Google OAuth state validation failed." });
    expect(complete).not.toHaveBeenCalled();
  });
});

function createGoogleTestApp(complete: CompleteGoogleSignIn) {
  return createApp({
    logger: false,
    oauthTransactionCookieSecret: "test-cookie-secret-that-is-long-enough-to-sign-values",
    secureCookies: false,
    getGoogleOAuthConfig: () => googleConfig,
    completeGoogleSignIn: { complete },
    sessionLifecycle: {
      authenticateAccessToken: vi.fn(),
      createSession: vi.fn().mockResolvedValue({
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        refreshToken: "refresh-token-created-after-google-sign-in"
      }),
      logout: vi.fn(),
      rotateRefreshToken: vi.fn()
    } as never
  });
}

const testUser = {
  accountId: "google-account-id",
  email: "person@example.com",
  id: "user-id",
  name: "Ada Lovelace",
  role: "USER" as const
};

function getCookieHeader(response: { headers: CookieHeaders }): string {
  const firstCookie = getCookieHeaders(response)[0];

  if (!firstCookie) {
    throw new Error("Expected OAuth transaction cookie.");
  }

  return firstCookie;
}

function getCookieHeaders(response: { headers: CookieHeaders }): string[] {
  const setCookie = response.headers["set-cookie"];

  if (typeof setCookie === "string") {
    return [setCookie];
  }

  return Array.isArray(setCookie) ? setCookie : [];
}

function getCookiePair(response: { headers: CookieHeaders }): string {
  return getCookieHeader(response).split(";", 1)[0];
}

function readTransaction(app: ReturnType<typeof createApp>, setCookie: string) {
  const signedValue = decodeURIComponent(getCookiePair({ headers: { "set-cookie": setCookie } }).split("=")[1]);
  const unsigned = app.unsignCookie(signedValue);
  const transaction = unsigned.valid ? deserializeGoogleOAuthTransaction(unsigned.value) : null;

  if (!transaction) {
    throw new Error("Expected a valid signed OAuth transaction.");
  }

  return transaction;
}
