import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  RefreshTokensRepository,
  SessionsRepository,
  type AuthDatabaseClient,
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

export class SessionLifecycleService {
  private readonly accessTokenSecret: Uint8Array;
  private readonly accessTokenTtlSeconds: number;
  private readonly clock: Clock;
  private readonly refreshTokenPepper: string;
  private readonly sessionTtlDays: number;

  public constructor(private readonly options: SessionLifecycleServiceOptions) {
    this.accessTokenSecret = new TextEncoder().encode(options.accessTokenSecret);
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
    this.clock = options.clock ?? (() => new Date());
    this.refreshTokenPepper = options.refreshTokenPepper;
    this.sessionTtlDays = options.sessionTtlDays ?? DEFAULT_SESSION_TTL_DAYS;
  }

  public async createSession(
    user: SessionUser,
    metadata: { ipAddress?: string; userAgent?: string }
  ): Promise<SessionCreation> {
    const now = this.clock();
    const expiresAt = addDays(now, this.sessionTtlDays);
    const refreshToken = createRefreshToken();

    await this.options.database.$transaction(async (database) => {
      const sessions = new SessionsRepository(database, this.clock);
      const refreshTokens = new RefreshTokensRepository(database, this.clock);
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
        tokenHash: this.hashRefreshToken(refreshToken)
      });
    });

    return { expiresAt, refreshToken };
  }

  public async rotateRefreshToken(rawRefreshToken: string | undefined): Promise<RefreshTokenRotation> {
    if (!rawRefreshToken) {
      return { kind: "invalid" };
    }

    const tokenHash = this.hashRefreshToken(rawRefreshToken);
    const rotation = await this.options.database.$transaction(async (database) => {
      const sessions = new SessionsRepository(database, this.clock);
      const refreshTokens = new RefreshTokensRepository(database, this.clock);
      const currentToken = await refreshTokens.findByTokenHash(tokenHash);

      if (!currentToken) {
        return { kind: "invalid" } as const;
      }

      const session = currentToken.session;
      const now = this.clock();
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
        // A parallel request consumed the same token. Treat it as reuse and close the family.
        await revokeCompromisedSession(refreshTokens, sessions, currentToken.familyId, session.id);
        return { kind: "invalid" } as const;
      }

      const replacementToken = createRefreshToken();
      await refreshTokens.create({
        id: replacementTokenId,
        expiresAt: currentToken.expiresAt,
        familyId: currentToken.familyId,
        sessionId: currentToken.sessionId,
        tokenHash: this.hashRefreshToken(replacementToken)
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
      accessToken: await this.createAccessToken(rotation.user, rotation.sessionId),
      accessTokenExpiresAt: new Date(
        this.clock().getTime() + this.accessTokenTtlSeconds * 1000
      ),
      expiresAt: rotation.expiresAt,
      kind: "rotated",
      refreshToken: rotation.refreshToken
    };
  }

  public async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = this.hashRefreshToken(rawRefreshToken);

    await this.options.database.$transaction(async (database) => {
      const sessions = new SessionsRepository(database, this.clock);
      const refreshTokens = new RefreshTokensRepository(database, this.clock);
      const refreshToken = await refreshTokens.findByTokenHash(tokenHash);

      if (!refreshToken) {
        return;
      }

      await refreshTokens.revokeForSession(refreshToken.sessionId);
      await sessions.revokeById(refreshToken.sessionId);
    });
  }

  public async authenticateAccessToken(accessToken: string): Promise<AuthenticatedSession | null> {
    try {
      const { payload } = await jwtVerify(accessToken, this.accessTokenSecret, {
        algorithms: [JWT_ALGORITHM],
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER
      });
      const userId = payload.sub;
      const sessionId = payload.sid;

      if (typeof userId !== "string" || typeof sessionId !== "string") {
        return null;
      }

      const sessions = new SessionsRepository(this.options.database, this.clock);
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

  private async createAccessToken(
    user: Pick<SessionUser, "id" | "role">,
    sessionId: string
  ): Promise<string> {
    const now = this.clock();

    return new SignJWT({ role: user.role, sid: sessionId })
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime(Math.floor(now.getTime() / 1000) + this.accessTokenTtlSeconds)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setIssuer(JWT_ISSUER)
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
      .setSubject(user.id)
      .sign(this.accessTokenSecret);
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHmac("sha256", this.refreshTokenPepper).update(refreshToken).digest("base64url");
  }
}

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
