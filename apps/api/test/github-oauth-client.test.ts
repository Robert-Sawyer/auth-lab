import { afterEach, describe, expect, it, vi } from "vitest";

import { createGitHubOAuthClient } from "../src/auth/github/github-oauth-client.js";

describe("createGitHubOAuthClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges the PKCE authorization code and retrieves a verified primary email", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "github-access-token" }))
      .mockResolvedValueOnce(jsonResponse({ avatar_url: "https://example.com/avatar.png", id: 42, name: "Ada" }))
      .mockResolvedValueOnce(
        jsonResponse([{ email: "Ada@Example.com", primary: true, verified: true }])
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createGitHubOAuthClient({
      clientId: "github-client-id",
      clientSecret: "github-client-secret",
      redirectUri: "http://localhost:3001/auth/github/callback"
    });

    await expect(
      client.completeAuthorizationCode({
        code: "authorization-code",
        codeVerifier: "original-pkce-verifier"
      })
    ).resolves.toEqual({
      email: "ada@example.com",
      imageUrl: "https://example.com/avatar.png",
      name: "Ada",
      providerAccountId: "42"
    });

    const [, tokenRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(tokenRequest.body));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST" })
    );
    expect(body.get("client_id")).toBe("github-client-id");
    expect(body.get("client_secret")).toBe("github-client-secret");
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("code_verifier")).toBe("original-pkce-verifier");
    expect(body.get("redirect_uri")).toBe("http://localhost:3001/auth/github/callback");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/user",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer github-access-token" }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/user/emails",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer github-access-token" }) })
    );
  });

  it("rejects an identity without a verified primary email", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "github-access-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: 42 }))
      .mockResolvedValueOnce(jsonResponse([{ email: "person@example.com", primary: true, verified: false }]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createGitHubOAuthClient({
      clientId: "github-client-id",
      clientSecret: "github-client-secret",
      redirectUri: "http://localhost:3001/auth/github/callback"
    });

    await expect(
      client.completeAuthorizationCode({ code: "authorization-code", codeVerifier: "pkce-verifier" })
    ).rejects.toMatchObject({ code: "OAUTH_CALLBACK_FAILED" });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
