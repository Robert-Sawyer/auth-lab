import type { AuthDatabase, CreateSessionInput } from "./types.js";

type Clock = () => Date;

export class SessionsRepository {
  public constructor(
    private readonly database: AuthDatabase,
    private readonly clock: Clock = () => new Date()
  ) {}

  public create(input: CreateSessionInput) {
    return this.database.session.create({ data: input });
  }

  public findActiveByIdForUser(id: string, userId: string) {
    return this.database.session.findFirst({
      where: {
        id,
        account: { userId },
        revokedAt: null,
        expiresAt: { gt: this.clock() }
      },
      include: { account: { include: { user: true } } }
    });
  }

  public listActiveForUser(userId: string) {
    return this.database.session.findMany({
      where: {
        account: { userId },
        revokedAt: null,
        expiresAt: { gt: this.clock() }
      },
      include: { account: true },
      orderBy: { lastActivityAt: "desc" }
    });
  }

  public revokeByIdForUser(id: string, userId: string) {
    return this.database.session.updateMany({
      where: { id, account: { userId }, revokedAt: null },
      data: { revokedAt: this.clock() }
    });
  }

  public revokeById(id: string) {
    return this.database.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: this.clock() }
    });
  }

  public revokeAllForUser(userId: string) {
    return this.database.session.updateMany({
      where: { account: { userId }, revokedAt: null },
      data: { revokedAt: this.clock() }
    });
  }

  public touch(id: string, userId: string) {
    const now = this.clock();

    return this.database.session.updateMany({
      where: { id, account: { userId }, revokedAt: null, expiresAt: { gt: now } },
      data: { lastActivityAt: now }
    });
  }
}
