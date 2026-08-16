import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1_000;

export type GitHubOAuthTransaction =
  | {
      codeVerifier: string;
      createdAt: number;
      intent: "sign-in";
      state: string;
    }
  | {
      codeVerifier: string;
      createdAt: number;
      intent: "link";
      state: string;
      userId: string;
    };

export function createGitHubOAuthTransaction(
  input: { userId?: string } = {},
  now = Date.now()
): GitHubOAuthTransaction {
  const transaction = {
    codeVerifier: randomBytes(32).toString("base64url"),
    createdAt: now,
    state: randomBytes(32).toString("base64url")
  };

  return input.userId
    ? { ...transaction, intent: "link", userId: input.userId }
    : { ...transaction, intent: "sign-in" };
}

export function createPkceCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function serializeGitHubOAuthTransaction(transaction: GitHubOAuthTransaction): string {
  return Buffer.from(JSON.stringify(transaction)).toString("base64url");
}

export function deserializeGitHubOAuthTransaction(value: string): GitHubOAuthTransaction | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (
      !isRecord(parsed) ||
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.createdAt !== "number" ||
      (parsed.intent !== "sign-in" && parsed.intent !== "link")
    ) {
      return null;
    }

    if (parsed.intent === "link") {
      return typeof parsed.userId === "string"
        ? {
            codeVerifier: parsed.codeVerifier,
            createdAt: parsed.createdAt,
            intent: "link",
            state: parsed.state,
            userId: parsed.userId
          }
        : null;
    }

    return {
      codeVerifier: parsed.codeVerifier,
      createdAt: parsed.createdAt,
      intent: "sign-in",
      state: parsed.state
    };
  } catch {
    return null;
  }
}

export function isValidGitHubOAuthCallback(
  transaction: GitHubOAuthTransaction,
  returnedState: string,
  now = Date.now()
): boolean {
  const age = now - transaction.createdAt;

  return (
    age >= 0 &&
    age <= OAUTH_TRANSACTION_TTL_MS &&
    hasSameValue(transaction.state, returnedState)
  );
}

function hasSameValue(first: string, second: string): boolean {
  const firstValue = Buffer.from(first);
  const secondValue = Buffer.from(second);

  return firstValue.length === secondValue.length && timingSafeEqual(firstValue, secondValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
