import { describe, expect, it, vi } from "vitest";

import type { AuthDatabaseClient } from "@auth-lab/database";

import { SessionLifecycleService } from "../src/auth/session/session-lifecycle-service.js";

const user = {
  accountId: "account-1",
  email: "person@example.com",
  id: "user-1",
  name: "Ada Lovelace",
  role: "USER" as const
};

describe("SessionLifecycleService", () => {
  it("rotates a refresh token and revokes the whole session when an old token is reused", async () => {
    const database = createSessionDatabase();
    const lifecycle = createLifecycle(database);

    const created = await lifecycle.createSession(user, {
      ipAddress: "127.0.0.1",
      userAgent: "Vitest"
    });

    expect(database.refreshTokens).toHaveLength(1);
    expect(database.refreshTokens[0]?.tokenHash).not.toBe(created.refreshToken);

    const rotation = await lifecycle.rotateRefreshToken(created.refreshToken);

    expect(rotation.kind).toBe("rotated");
    if (rotation.kind !== "rotated") {
      throw new Error("Expected a successful refresh-token rotation.");
    }

    expect(rotation.refreshToken).not.toBe(created.refreshToken);
    expect(database.refreshTokens).toHaveLength(2);
    expect(database.refreshTokens[0]?.usedAt).toBeInstanceOf(Date);
    expect(database.refreshTokens[0]?.replacedByTokenId).toBe(database.refreshTokens[1]?.id);

    await expect(lifecycle.authenticateAccessToken(rotation.accessToken)).resolves.toMatchObject({
      sessionId: "session-1",
      user: { id: user.id, role: "USER" }
    });

    await expect(lifecycle.rotateRefreshToken(created.refreshToken)).resolves.toEqual({ kind: "invalid" });
    expect(database.sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(database.refreshTokens.every((token) => token.revokedAt instanceof Date)).toBe(true);
    await expect(lifecycle.authenticateAccessToken(rotation.accessToken)).resolves.toBeNull();
  });

  it("revokes the current session and every refresh token on logout", async () => {
    const database = createSessionDatabase();
    const lifecycle = createLifecycle(database);
    const created = await lifecycle.createSession(user, {});
    const rotation = await lifecycle.rotateRefreshToken(created.refreshToken);

    if (rotation.kind !== "rotated") {
      throw new Error("Expected a successful refresh-token rotation.");
    }

    await lifecycle.logout(rotation.refreshToken);

    expect(database.sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(database.refreshTokens.every((token) => token.revokedAt instanceof Date)).toBe(true);
    await expect(lifecycle.authenticateAccessToken(rotation.accessToken)).resolves.toBeNull();
  });
});

function createLifecycle(database: ReturnType<typeof createSessionDatabase>) {
  return new SessionLifecycleService({
    accessTokenSecret: "test-access-token-secret-that-is-long-enough",
    database: database.client,
    refreshTokenPepper: "test-refresh-token-pepper-that-is-long-enough",
    sessionTtlDays: 30
  });
}

function createSessionDatabase() {
  const sessions: StoredSession[] = [];
  const refreshTokens: StoredRefreshToken[] = [];
  let sessionSequence = 0;
  let refreshTokenSequence = 0;

  const account = {
    id: user.accountId,
    userId: user.id,
    user: { email: user.email, id: user.id, name: user.name, role: user.role }
  };

  const client = {
    $transaction: async <Result>(callback: (transaction: unknown) => Promise<Result>) => callback(client),
    session: {
      create: vi.fn(async ({ data }) => {
        const session: StoredSession = {
          ...data,
          createdAt: new Date(),
          id: `session-${++sessionSequence}`,
          lastActivityAt: new Date(),
          revokedAt: null
        };
        sessions.push(session);
        return session;
      }),
      findFirst: vi.fn(async ({ where }) => {
        const session = sessions.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.revokedAt === where.revokedAt &&
            candidate.expiresAt > where.expiresAt.gt &&
            where.account.userId === account.userId
        );

        return session ? { ...session, account } : null;
      }),
      findMany: vi.fn(),
      updateMany: vi.fn(async ({ data, where }) => {
        const affectedSessions = sessions.filter(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.revokedAt === undefined || candidate.revokedAt === where.revokedAt) &&
            (where.account === undefined || where.account.userId === account.userId) &&
            (where.expiresAt === undefined || candidate.expiresAt > where.expiresAt.gt)
        );

        affectedSessions.forEach((session) => Object.assign(session, data));
        return { count: affectedSessions.length };
      })
    },
    refreshToken: {
      create: vi.fn(async ({ data }) => {
        const refreshToken: StoredRefreshToken = {
          ...data,
          createdAt: new Date(),
          id: data.id ?? `refresh-token-${++refreshTokenSequence}`,
          replacedByTokenId: null,
          revokedAt: null,
          usedAt: null
        };
        refreshTokens.push(refreshToken);
        return refreshToken;
      }),
      findUnique: vi.fn(async ({ where }) => {
        const refreshToken = refreshTokens.find((candidate) => candidate.tokenHash === where.tokenHash);
        const session = refreshToken
          ? sessions.find((candidate) => candidate.id === refreshToken.sessionId)
          : undefined;

        return refreshToken && session ? { ...refreshToken, session: { ...session, account } } : null;
      }),
      updateMany: vi.fn(async ({ data, where }) => {
        const affectedTokens = refreshTokens.filter(
          (candidate) =>
            (where.id === undefined || candidate.id === where.id) &&
            (where.familyId === undefined || candidate.familyId === where.familyId) &&
            (where.sessionId === undefined || candidate.sessionId === where.sessionId) &&
            (where.usedAt === undefined || candidate.usedAt === where.usedAt) &&
            (where.revokedAt === undefined || candidate.revokedAt === where.revokedAt) &&
            (where.expiresAt === undefined || candidate.expiresAt > where.expiresAt.gt)
        );

        affectedTokens.forEach((refreshToken) => Object.assign(refreshToken, data));
        return { count: affectedTokens.length };
      })
    }
  };

  return {
    client: client as unknown as AuthDatabaseClient,
    refreshTokens,
    sessions
  };
}

type StoredSession = {
  accountId: string;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  ipAddress: string | null;
  lastActivityAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
};

type StoredRefreshToken = {
  createdAt: Date;
  expiresAt: Date;
  familyId: string;
  id: string;
  replacedByTokenId: string | null;
  revokedAt: Date | null;
  sessionId: string;
  tokenHash: string;
  usedAt: Date | null;
};
