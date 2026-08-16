import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { CompleteGitHubAuthorizationInput } from "../src/auth/github/github-oauth-client.js";
import { deserializeGitHubOAuthTransaction } from "../src/auth/github/transaction.js";
import type { SessionUser } from "../src/auth/session/session-lifecycle-service.js";

type CompleteGitHubSignIn = (input: CompleteGitHubAuthorizationInput) => Promise<SessionUser>;
type LinkGitHubAccount = (userId: string, input: CompleteGitHubAuthorizationInput) => Promise<SessionUser>;
type CookieHeaders = Record<string, string | string[] | number | undefined>;

const githubConfig = {
  clientId: "github-client-id",
  clientSecret: "github-client-secret",
  redirectUri: "http://localhost:3001/auth/github/callback"
};
const webOrigin = "http://localhost:3000";

describe("GitHub OAuth routes", () => {
  const apps = new Set<ReturnType<typeof createApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  it("starts a GitHub Authorization Code Flow with state and PKCE", async () => {
    const complete = vi.fn<CompleteGitHubSignIn>();
    const link = vi.fn<LinkGitHubAccount>();
    const app = createGitHubTestApp(complete, link);
    apps.add(app);

    const response = await app.inject({ method: "GET", url: "/auth/github" });
    const authorizationUrl = new URL(response.headers.location as string);
    const transaction = readTransaction(app, getCookieHeader(response));

    expect(response.statusCode).toBe(302);
    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.pathname).toBe("/login/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(githubConfig.clientId);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(githubConfig.redirectUri);
    expect(authorizationUrl.searchParams.get("scope")).toBe("read:user user:email");
    expect(authorizationUrl.searchParams.get("state")).toBe(transaction.state);
    expect(transaction.intent).toBe("sign-in");
    expect(getCookieHeader(response)).toContain("HttpOnly");
    expect(getCookieHeader(response)).toContain("Path=/auth/github");
    expect(getCookieHeader(response)).toContain("SameSite=Lax");
  });

  it("creates a signed link transaction only for an authenticated user from the trusted origin", async () => {
    const complete = vi.fn<CompleteGitHubSignIn>();
    const link = vi.fn<LinkGitHubAccount>();
    const app = createGitHubTestApp(complete, link);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/auth/github/link",
      headers: { authorization: "Bearer short-lived-access-token", origin: webOrigin }
    });
    const transaction = readTransaction(app, getCookieHeader(response));
    const authorizationUrl = new URL(response.json<{ authorizationUrl: string }>().authorizationUrl);

    expect(response.statusCode).toBe(200);
    expect(transaction).toMatchObject({ intent: "link", userId: "user-1" });
    expect(authorizationUrl.searchParams.get("state")).toBe(transaction.state);
    expect(link).not.toHaveBeenCalled();
  });

  it("creates an application session after a successful GitHub sign-in", async () => {
    const complete = vi.fn<CompleteGitHubSignIn>().mockResolvedValue(testUser);
    const link = vi.fn<LinkGitHubAccount>();
    const sessionLifecycle = createSessionLifecycle();
    const app = createGitHubTestApp(complete, link, sessionLifecycle);
    apps.add(app);

    const start = await app.inject({ method: "GET", url: "/auth/github" });
    const transaction = readTransaction(app, getCookieHeader(start));
    const callback = await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=authorization-code&state=${transaction.state}`,
      headers: { cookie: getCookiePair(start) }
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:3000/?oauth=github-complete");
    expect(complete).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier: transaction.codeVerifier
    });
    expect(sessionLifecycle.createSession).toHaveBeenCalledWith(testUser, expect.any(Object));
    expect(getCookieHeaders(callback)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("oauth_github_transaction=;"),
        expect.stringContaining("refresh_token=")
      ])
    );
  });

  it("links GitHub to the user from the signed transaction without creating a new session", async () => {
    const complete = vi.fn<CompleteGitHubSignIn>();
    const link = vi.fn<LinkGitHubAccount>().mockResolvedValue(testUser);
    const sessionLifecycle = createSessionLifecycle();
    const app = createGitHubTestApp(complete, link, sessionLifecycle);
    apps.add(app);

    const start = await app.inject({
      method: "POST",
      url: "/auth/github/link",
      headers: { authorization: "Bearer short-lived-access-token", origin: webOrigin }
    });
    const transaction = readTransaction(app, getCookieHeader(start));

    if (transaction.intent !== "link") {
      throw new Error("Expected a GitHub linking transaction.");
    }

    const callback = await app.inject({
      method: "GET",
      url: `/auth/github/callback?code=authorization-code&state=${transaction.state}`,
      headers: { cookie: getCookiePair(start) }
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:3000/?oauth=github-linked");
    expect(link).toHaveBeenCalledWith("user-1", {
      code: "authorization-code",
      codeVerifier: transaction.codeVerifier
    });
    expect(sessionLifecycle.createSession).not.toHaveBeenCalled();
  });
});

function createGitHubTestApp(
  complete: CompleteGitHubSignIn,
  link: LinkGitHubAccount,
  sessionLifecycle = createSessionLifecycle()
) {
  return createApp({
    logger: false,
    oauthTransactionCookieSecret: "test-cookie-secret-that-is-long-enough-to-sign-values",
    secureCookies: false,
    webOrigin,
    getGitHubOAuthConfig: () => githubConfig,
    completeGitHubSignIn: { complete, link },
    sessionLifecycle: sessionLifecycle as never
  });
}

function createSessionLifecycle() {
  return {
    authenticateAccessToken: vi.fn().mockResolvedValue({
      sessionExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
      sessionId: "session-1",
      user: { email: "person@example.com", id: "user-1", name: "Ada Lovelace", role: "USER" }
    }),
    createSession: vi.fn().mockResolvedValue({
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      refreshToken: "refresh-token-created-after-github-sign-in"
    }),
    logout: vi.fn(),
    rotateRefreshToken: vi.fn()
  };
}

const testUser = {
  accountId: "github-account-id",
  email: "person@example.com",
  id: "user-1",
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

  return typeof setCookie === "string" ? [setCookie] : Array.isArray(setCookie) ? setCookie : [];
}

function getCookiePair(response: { headers: CookieHeaders }): string {
  return getCookieHeader(response).split(";", 1)[0];
}

function readTransaction(app: ReturnType<typeof createApp>, setCookie: string) {
  const signedValue = decodeURIComponent(getCookiePair({ headers: { "set-cookie": setCookie } }).split("=")[1]);
  const unsigned = app.unsignCookie(signedValue);
  const transaction = unsigned.valid ? deserializeGitHubOAuthTransaction(unsigned.value) : null;

  if (!transaction) {
    throw new Error("Expected a valid signed GitHub OAuth transaction.");
  }

  return transaction;
}
