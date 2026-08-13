import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1_000;

export type GoogleOAuthTransaction = {
  codeVerifier: string;
  createdAt: number;
  nonce: string;
  state: string;
};

export function createGoogleOAuthTransaction(now = Date.now()): GoogleOAuthTransaction {
  return {
    state: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    createdAt: now
  };
}

export function createPkceCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function serializeGoogleOAuthTransaction(transaction: GoogleOAuthTransaction): string {
  return Buffer.from(JSON.stringify(transaction)).toString("base64url");
}

export function deserializeGoogleOAuthTransaction(value: string): GoogleOAuthTransaction | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (
      !isRecord(parsed) ||
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }

    return {
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      nonce: parsed.nonce,
      createdAt: parsed.createdAt
    };
  } catch {
    return null;
  }
}

export function isValidGoogleOAuthCallback(
  transaction: GoogleOAuthTransaction,
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
