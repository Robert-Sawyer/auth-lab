import type { AuthDatabase, CreateRefreshTokenInput } from "./types.js";

type Clock = () => Date;

export class RefreshTokensRepository {
  public constructor(
    private readonly database: AuthDatabase,
    private readonly clock: Clock = () => new Date()
  ) {}

  public create(input: CreateRefreshTokenInput) {
    return this.database.refreshToken.create({ data: input });
  }

  public findByTokenHash(tokenHash: string) {
    return this.database.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: { include: { account: { include: { user: true } } } } }
    });
  }

  public markUsedAndReplaced(id: string, replacementTokenId: string) {
    const now = this.clock();

    return this.database.refreshToken.updateMany({
      where: { id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, replacedByTokenId: replacementTokenId }
    });
  }

  public revokeFamily(familyId: string) {
    return this.database.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock() }
    });
  }

  public revokeForSession(sessionId: string) {
    return this.database.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: this.clock() }
    });
  }
}
