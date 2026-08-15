import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoogleOidcClient } from "../src/auth/google/google-oidc-client.js";

describe("createGoogleOidcClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges the authorization code with the original PKCE verifier", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id_token: "not-a-valid-jwt" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createGoogleOidcClient({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      redirectUri: "http://localhost:3001/auth/google/callback"
    });

    await expect(
      client.completeAuthorizationCode({
        code: "authorization-code",
        codeVerifier: "original-pkce-verifier",
        nonce: "original-nonce"
      })
    ).rejects.toMatchObject({ code: "OAUTH_CALLBACK_FAILED" });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(request.body));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(body.get("client_id")).toBe("google-client-id");
    expect(body.get("client_secret")).toBe("google-client-secret");
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("code_verifier")).toBe("original-pkce-verifier");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("http://localhost:3001/auth/google/callback");
  });
});
