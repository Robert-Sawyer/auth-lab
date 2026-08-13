import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { createPkceCodeChallenge, deserializeGoogleOAuthTransaction } from "../src/auth/google/transaction.js";

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
    const complete = vi.fn();
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
    const complete = vi.fn().mockResolvedValue({ id: "user-id" });
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
    expect(callback.headers["set-cookie"]).toContain("oauth_google_transaction=;");
    expect(complete).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier: transaction.codeVerifier,
      nonce: transaction.nonce
    });
  });

  it("rejects callbacks with a mismatched state before exchanging the authorization code", async () => {
    const complete = vi.fn();
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

function createGoogleTestApp(complete: ReturnType<typeof vi.fn>) {
  return createApp({
    logger: false,
    oauthTransactionCookieSecret: "test-cookie-secret-that-is-long-enough-to-sign-values",
    secureCookies: false,
    getGoogleOAuthConfig: () => googleConfig,
    completeGoogleSignIn: { complete }
  });
}

function getCookieHeader(response: { headers: Record<string, string | string[] | undefined> }): string {
  const setCookie = response.headers["set-cookie"];

  if (typeof setCookie === "string") {
    return setCookie;
  }

  if (Array.isArray(setCookie) && setCookie[0]) {
    return setCookie[0];
  }

  throw new Error("Expected OAuth transaction cookie.");
}

function getCookiePair(response: { headers: Record<string, string | string[] | undefined> }): string {
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
