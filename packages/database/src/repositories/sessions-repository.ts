import type { AuthDatabase, CreateSessionInput } from "./types.js";

type Clock = () => Date;

export function createSessionsRepository(
  database: AuthDatabase,
  clock: Clock = () => new Date()
) {
  return {
    create(input: CreateSessionInput) {
      return database.session.create({ data: input });
    },

    findActiveByIdForUser(id: string, userId: string) {
      return database.session.findFirst({
        where: {
          id,
          account: { userId },
          revokedAt: null,
          expiresAt: { gt: clock() }
        },
        include: { account: { include: { user: true } } }
      });
    },

    listActiveForUser(userId: string) {
      return database.session.findMany({
        where: {
          account: { userId },
          revokedAt: null,
          expiresAt: { gt: clock() }
        },
        include: { account: true },
        orderBy: { lastActivityAt: "desc" }
      });
    },

    revokeByIdForUser(id: string, userId: string) {
      return database.session.updateMany({
        where: { id, account: { userId }, revokedAt: null },
        data: { revokedAt: clock() }
      });
    },

    revokeById(id: string) {
      return database.session.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: clock() }
      });
    },

    revokeAllForUser(userId: string) {
      return database.session.updateMany({
        where: { account: { userId }, revokedAt: null },
        data: { revokedAt: clock() }
      });
    },

    touch(id: string, userId: string) {
      const now = clock();

      return database.session.updateMany({
        where: { id, account: { userId }, revokedAt: null, expiresAt: { gt: now } },
        data: { lastActivityAt: now }
      });
    }
  };
}

export type SessionsRepository = ReturnType<typeof createSessionsRepository>;
