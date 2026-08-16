import { createOAuthCallbackError } from "../errors.js";
import {
  createPkceCodeChallenge,
  type GitHubOAuthTransaction
} from "./transaction.js";

const GITHUB_API_URL = "https://api.github.com";
const GITHUB_AUTHORIZATION_ENDPOINT = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";

export type GitHubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GitHubIdentity = {
  email: string;
  imageUrl: string | null;
  name: string | null;
  providerAccountId: string;
};

export type CompleteGitHubAuthorizationInput = Pick<GitHubOAuthTransaction, "codeVerifier"> & {
  code: string;
};

export function createGitHubAuthorizationUrl(
  config: Pick<GitHubOAuthConfig, "clientId" | "redirectUri">,
  transaction: GitHubOAuthTransaction
): string {
  const url = new URL(GITHUB_AUTHORIZATION_ENDPOINT);

  url.search = new URLSearchParams({
    client_id: config.clientId,
    code_challenge: createPkceCodeChallenge(transaction.codeVerifier),
    code_challenge_method: "S256",
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "read:user user:email",
    state: transaction.state
  }).toString();

  return url.toString();
}

export function createGitHubOAuthClient(config: GitHubOAuthConfig) {
  return {
    async completeAuthorizationCode(
      input: CompleteGitHubAuthorizationInput
    ): Promise<GitHubIdentity> {
      const tokenResponse = await fetch(GITHUB_TOKEN_ENDPOINT, {
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
          redirect_uri: config.redirectUri
        })
      });

      if (!tokenResponse.ok) {
        throw createOAuthCallbackError("GitHub rejected the authorization code.");
      }

      const tokenPayload = await readJson(tokenResponse, "GitHub returned an invalid token response.");
      const accessToken = readAccessToken(tokenPayload);
      const user = await getGitHubUser(accessToken);
      const email = await getPrimaryVerifiedEmail(accessToken);

      return {
        email,
        imageUrl: readNullableString(user, "avatar_url"),
        name: readNullableString(user, "name"),
        providerAccountId: readGitHubUserId(user)
      };
    }
  };
}

export type GitHubOAuthClient = ReturnType<typeof createGitHubOAuthClient>;

async function getGitHubUser(accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${GITHUB_API_URL}/user`, { headers: getGitHubApiHeaders(accessToken) });

  if (!response.ok) {
    throw createOAuthCallbackError("GitHub user profile could not be retrieved.");
  }

  const user = await readJson(response, "GitHub returned an invalid user profile.");

  if (!isRecord(user)) {
    throw createOAuthCallbackError("GitHub returned an invalid user profile.");
  }

  return user;
}

async function getPrimaryVerifiedEmail(accessToken: string): Promise<string> {
  const response = await fetch(`${GITHUB_API_URL}/user/emails`, {
    headers: getGitHubApiHeaders(accessToken)
  });

  if (!response.ok) {
    throw createOAuthCallbackError("GitHub primary email could not be retrieved.");
  }

  const emails = await readJson(response, "GitHub returned an invalid email response.");

  if (!Array.isArray(emails)) {
    throw createOAuthCallbackError("GitHub returned an invalid email response.");
  }

  const primaryEmail = emails.find(isPrimaryVerifiedEmail);

  if (!primaryEmail) {
    throw createOAuthCallbackError("GitHub did not return a verified primary email address.");
  }

  return primaryEmail.email.trim().toLowerCase();
}

function getGitHubApiHeaders(accessToken: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "x-github-api-version": "2022-11-28"
  };
}

function readAccessToken(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    throw createOAuthCallbackError("GitHub did not return an access token.");
  }

  return payload.access_token;
}

function readGitHubUserId(user: Record<string, unknown>): string {
  const id = user.id;

  if (typeof id !== "string" && typeof id !== "number") {
    throw createOAuthCallbackError("GitHub did not return a user ID.");
  }

  return String(id);
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];

  return typeof value === "string" ? value : null;
}

function isPrimaryVerifiedEmail(value: unknown): value is { email: string; primary: true; verified: true } {
  return (
    isRecord(value) &&
    typeof value.email === "string" &&
    value.primary === true &&
    value.verified === true
  );
}

async function readJson(response: Response, errorMessage: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw createOAuthCallbackError(errorMessage);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
