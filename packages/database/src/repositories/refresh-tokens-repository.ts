import type { AuthDatabase, CreateRefreshTokenInput } from "./types.js";

type Clock = () => Date;

export function createRefreshTokensRepository(
  database: AuthDatabase,
  clock: Clock = () => new Date()
) {
  return {
    create(input: CreateRefreshTokenInput) {
      return database.refreshToken.create({ data: input });
    },

    findByTokenHash(tokenHash: string) {
      return database.refreshToken.findUnique({
        where: { tokenHash },
        include: { session: { include: { account: { include: { user: true } } } } }
      });
    },

    markUsedAndReplaced(id: string, replacementTokenId: string) {
      const now = clock();

      return database.refreshToken.updateMany({
        where: { id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now, replacedByTokenId: replacementTokenId }
      });
    },

    revokeFamily(familyId: string) {
      return database.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: clock() }
      });
    },

    revokeForSession(sessionId: string) {
      return database.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: clock() }
      });
    },

    revokeForUser(userId: string) {
      return database.refreshToken.updateMany({
        where: { session: { account: { userId } }, revokedAt: null },
        data: { revokedAt: clock() }
      });
    }
  };
}

export type RefreshTokensRepository = ReturnType<typeof createRefreshTokensRepository>;
