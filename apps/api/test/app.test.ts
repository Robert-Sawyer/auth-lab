import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("GET /health", () => {
  const apps = new Set<ReturnType<typeof createApp>>();

  afterEach(async () => {
    await Promise.all([...apps].map((app) => app.close()));
    apps.clear();
  });

  it("returns the API health status", async () => {
    const app = createApp({ logger: false });
    apps.add(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "api" });
  });

  it("permits credentialed requests from the configured web origin", async () => {
    const webOrigin = "http://localhost:3000";
    const app = createApp({ logger: false, webOrigin });
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: webOrigin }
    });

    expect(response.headers["access-control-allow-origin"]).toBe(webOrigin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
