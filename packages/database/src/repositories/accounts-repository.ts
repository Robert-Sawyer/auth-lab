import type { OAuthProvider } from "../generated/prisma/client.js";

import type {
  AuthDatabase,
  CreateAccountForNewUserInput,
  CreateAccountInput
} from "./types.js";

export class AccountsRepository {
  public constructor(private readonly database: AuthDatabase) {}

  public findByProviderAccount(provider: OAuthProvider, providerAccountId: string) {
    return this.database.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } }
    });
  }

  public findByUserId(userId: string) {
    return this.database.account.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" }
    });
  }

  public create(input: CreateAccountInput) {
    return this.database.account.create({ data: input });
  }

  public createForNewUser({ user, ...account }: CreateAccountForNewUserInput) {
    return this.database.account.create({
      data: {
        ...account,
        user: { create: user }
      },
      include: { user: true }
    });
  }
}
