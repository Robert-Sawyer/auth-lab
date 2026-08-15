import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  createRefreshTokensRepository,
  createSessionsRepository,
  type AuthDatabaseClient,
  type RefreshTokensRepository,
  type SessionsRepository,
  type UserRole
} from "@auth-lab/database";
import { SignJWT, jwtVerify } from "jose";

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_SESSION_TTL_DAYS = 30;
const JWT_ALGORITHM = "HS256";
const JWT_AUDIENCE = "auth-lab-web";
const JWT_ISSUER = "auth-lab-api";

type Clock = () => Date;

export type SessionUser = {
  accountId: string;
  email: string;
  id: string;
  name: string | null;
  role: UserRole;
};

export type AuthenticatedSession = {
  sessionId: string;
  sessionExpiresAt: Date;
  user: Omit<SessionUser, "accountId">;
};

export type SessionCreation = {
  expiresAt: Date;
  refreshToken: string;
};

export type RefreshTokenRotation =
  | {
      accessToken: string;
      accessTokenExpiresAt: Date;
      expiresAt: Date;
      kind: "rotated";
      refreshToken: string;
    }
  | { kind: "invalid" };

export type SessionLifecycleServiceOptions = {
  accessTokenSecret: string;
  accessTokenTtlSeconds?: number;
  clock?: Clock;
  database: AuthDatabaseClient;
  refreshTokenPepper: string;
  sessionTtlDays?: number;
};

export function createSessionLifecycleService(options: SessionLifecycleServiceOptions) {
  const accessTokenSecret = new TextEncoder().encode(options.accessTokenSecret);
  const accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const clock = options.clock ?? (() => new Date());
  const refreshTokenPepper = options.refreshTokenPepper;
  const sessionTtlDays = options.sessionTtlDays ?? DEFAULT_SESSION_TTL_DAYS;

  function hashRefreshToken(refreshToken: string): string {
    return createHmac("sha256", refreshTokenPepper).update(refreshToken).digest("base64url");
  }

  async function createAccessToken(
    user: Pick<SessionUser, "id" | "role">,
    sessionId: string
  ): Promise<string> {
    const now = clock();

    return new SignJWT({ role: user.role, sid: sessionId })
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime(Math.floor(now.getTime() / 1000) + accessTokenTtlSeconds)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setIssuer(JWT_ISSUER)
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
      .setSubject(user.id)
      .sign(accessTokenSecret);
  }

  async function createSession(
    user: SessionUser,
    metadata: { ipAddress?: string; userAgent?: string }
  ): Promise<SessionCreation> {
    const now = clock();
    const expiresAt = addDays(now, sessionTtlDays);
    const refreshToken = createRefreshToken();

    await options.database.$transaction(async (database) => {
      const sessions = createSessionsRepository(database, clock);
      const refreshTokens = createRefreshTokensRepository(database, clock);
      const session = await sessions.create({
        accountId: user.accountId,
        expiresAt,
        ipAddress: metadata.ipAddress ?? null,
        userAgent: metadata.userAgent ?? null
      });

      await refreshTokens.create({
        expiresAt,
        familyId: randomUUID(),
        sessionId: session.id,
        tokenHash: hashRefreshToken(refreshToken)
      });
    });

    return { expiresAt, refreshToken };
  }

  async function rotateRefreshToken(rawRefreshToken: string | undefined): Promise<RefreshTokenRotation> {
    if (!rawRefreshToken) {
      return { kind: "invalid" };
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);
    const rotation = await options.database.$transaction(async (database) => {
      const sessions = createSessionsRepository(database, clock);
      const refreshTokens = createRefreshTokensRepository(database, clock);
      const currentToken = await refreshTokens.findByTokenHash(tokenHash);

      if (!currentToken) {
        return { kind: "invalid" } as const;
      }

      const session = currentToken.session;
      const now = clock();
      const tokenCannotBeUsed =
        currentToken.revokedAt !== null ||
        currentToken.expiresAt <= now ||
        session.revokedAt !== null ||
        session.expiresAt <= now;

      if (currentToken.usedAt !== null || tokenCannotBeUsed) {
        await revokeCompromisedSession(refreshTokens, sessions, currentToken.familyId, session.id);
        return { kind: "invalid" } as const;
      }

      const replacementTokenId = randomUUID();
      const consumption = await refreshTokens.markUsedAndReplaced(currentToken.id, replacementTokenId);

      if (consumption.count !== 1) {
        await revokeCompromisedSession(refreshTokens, sessions, currentToken.familyId, session.id);
        return { kind: "invalid" } as const;
      }

      const replacementToken = createRefreshToken();
      await refreshTokens.create({
        id: replacementTokenId,
        expiresAt: currentToken.expiresAt,
        familyId: currentToken.familyId,
        sessionId: currentToken.sessionId,
        tokenHash: hashRefreshToken(replacementToken)
      });
      await sessions.touch(session.id, session.account.userId);

      return {
        expiresAt: currentToken.expiresAt,
        kind: "rotated" as const,
        refreshToken: replacementToken,
        sessionId: session.id,
        user: session.account.user
      };
    });

    if (rotation.kind === "invalid") {
      return rotation;
    }

    return {
      accessToken: await createAccessToken(rotation.user, rotation.sessionId),
      accessTokenExpiresAt: new Date(clock().getTime() + accessTokenTtlSeconds * 1000),
      expiresAt: rotation.expiresAt,
      kind: "rotated",
      refreshToken: rotation.refreshToken
    };
  }

  async function logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);

    await options.database.$transaction(async (database) => {
      const sessions = createSessionsRepository(database, clock);
      const refreshTokens = createRefreshTokensRepository(database, clock);
      const refreshToken = await refreshTokens.findByTokenHash(tokenHash);

      if (!refreshToken) {
        return;
      }

      await refreshTokens.revokeForSession(refreshToken.sessionId);
      await sessions.revokeById(refreshToken.sessionId);
    });
  }

  async function authenticateAccessToken(accessToken: string): Promise<AuthenticatedSession | null> {
    try {
      const { payload } = await jwtVerify(accessToken, accessTokenSecret, {
        algorithms: [JWT_ALGORITHM],
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER
      });
      const userId = payload.sub;
      const sessionId = payload.sid;

      if (typeof userId !== "string" || typeof sessionId !== "string") {
        return null;
      }

      const sessions = createSessionsRepository(options.database, clock);
      const session = await sessions.findActiveByIdForUser(sessionId, userId);

      if (!session) {
        return null;
      }

      return {
        sessionId: session.id,
        sessionExpiresAt: session.expiresAt,
        user: {
          email: session.account.user.email,
          id: session.account.user.id,
          name: session.account.user.name,
          role: session.account.user.role
        }
      };
    } catch {
      return null;
    }
  }

  return { authenticateAccessToken, createSession, logout, rotateRefreshToken };
}

export type SessionLifecycle = ReturnType<typeof createSessionLifecycleService>;

async function revokeCompromisedSession(
  refreshTokens: RefreshTokensRepository,
  sessions: SessionsRepository,
  familyId: string,
  sessionId: string
) {
  await refreshTokens.revokeFamily(familyId);
  await sessions.revokeById(sessionId);
}

function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
