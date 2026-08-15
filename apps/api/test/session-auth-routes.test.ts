import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";

const webOrigin = "http://localhost:3000";
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const accessTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

describe("application-session routes", () => {
  const apps = new Set<ReturnType<typeof createApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  it("rotates the refresh cookie and returns a short-lived access token only to the trusted origin", async () => {
    const sessionLifecycle = createSessionLifecycle();
    const app = createSessionTestApp(sessionLifecycle, true);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: "refresh_token=old-refresh-token", origin: webOrigin }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accessToken: "short-lived-access-token",
      expiresIn: expect.any(Number),
      tokenType: "Bearer"
    });
    expect(response.headers["set-cookie"]).toContain("refresh_token=new-refresh-token");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Path=/auth");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(sessionLifecycle.rotateRefreshToken).toHaveBeenCalledWith("old-refresh-token");

    const blocked = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: "refresh_token=attacker-token", origin: "https://attacker.example" }
    });

    expect(blocked.statusCode).toBe(403);
    expect(sessionLifecycle.rotateRefreshToken).toHaveBeenCalledTimes(1);
  });

  it("authorizes a protected route through the Bearer access-token middleware", async () => {
    const sessionLifecycle = createSessionLifecycle();
    const app = createSessionTestApp(sessionLifecycle);
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: "Bearer short-lived-access-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      session: { expiresAt: future.toISOString(), id: "session-1" },
      user: { email: "person@example.com", id: "user-1", name: "Ada Lovelace", role: "USER" }
    });
    expect(sessionLifecycle.authenticateAccessToken).toHaveBeenCalledWith("short-lived-access-token");
  });

  it("logs out the current refresh-token session and clears its cookie", async () => {
    const sessionLifecycle = createSessionLifecycle();
    const app = createSessionTestApp(sessionLifecycle);
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: "refresh_token=current-refresh-token", origin: webOrigin }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toContain("refresh_token=;");
    expect(sessionLifecycle.logout).toHaveBeenCalledWith("current-refresh-token");
  });
});

function createSessionTestApp(
  sessionLifecycle: ReturnType<typeof createSessionLifecycle>,
  secureCookies = false
) {
  return createApp({ logger: false, secureCookies, sessionLifecycle: sessionLifecycle as never, webOrigin });
}

function createSessionLifecycle() {
  return {
    authenticateAccessToken: vi.fn().mockResolvedValue({
      sessionExpiresAt: future,
      sessionId: "session-1",
      user: { email: "person@example.com", id: "user-1", name: "Ada Lovelace", role: "USER" }
    }),
    createSession: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    rotateRefreshToken: vi.fn().mockResolvedValue({
      accessToken: "short-lived-access-token",
      accessTokenExpiresAt,
      expiresAt: future,
      kind: "rotated",
      refreshToken: "new-refresh-token"
    })
  };
}
