import {
  createRefreshTokensRepository,
  createSessionsRepository,
  type AuthDatabaseClient,
  type OAuthProvider
} from "@auth-lab/database";

type Clock = () => Date;

export type ManagedSession = {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  ipAddress: string | null;
  isCurrent: boolean;
  lastActivityAt: Date;
  provider: OAuthProvider;
  userAgent: string | null;
};

export function createSessionManagementService(
  database: AuthDatabaseClient,
  clock: Clock = () => new Date()
) {
  async function listActiveSessions(
    userId: string,
    currentSessionId: string
  ): Promise<ManagedSession[]> {
    const sessions = createSessionsRepository(database, clock);
    const activeSessions = await sessions.listActiveForUser(userId);

    return activeSessions.map((session) => ({
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      id: session.id,
      ipAddress: session.ipAddress,
      isCurrent: session.id === currentSessionId,
      lastActivityAt: session.lastActivityAt,
      provider: session.account.provider,
      userAgent: session.userAgent
    }));
  }

  async function revokeAllSessionsForUser(userId: string): Promise<number> {
    return database.$transaction(async (transaction) => {
      const sessions = createSessionsRepository(transaction, clock);
      const refreshTokens = createRefreshTokensRepository(transaction, clock);
      const revokedSessions = await sessions.revokeAllForUser(userId);

      await refreshTokens.revokeForUser(userId);

      return revokedSessions.count;
    });
  }

  async function revokeSessionForUser(sessionId: string, userId: string): Promise<boolean> {
    return database.$transaction(async (transaction) => {
      const sessions = createSessionsRepository(transaction, clock);
      const refreshTokens = createRefreshTokensRepository(transaction, clock);
      const revokedSession = await sessions.revokeByIdForUser(sessionId, userId);

      if (revokedSession.count !== 1) {
        return false;
      }

      await refreshTokens.revokeForSession(sessionId);
      return true;
    });
  }

  return { listActiveSessions, revokeAllSessionsForUser, revokeSessionForUser };
}

export type SessionManagement = ReturnType<typeof createSessionManagementService>;
