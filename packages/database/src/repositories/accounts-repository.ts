import type { OAuthProvider } from "../generated/prisma/client.js";

import type {
  AuthDatabase,
  CreateAccountForNewUserInput,
  CreateAccountInput
} from "./types.js";

export function createAccountsRepository(database: AuthDatabase) {
  return {
    findByProviderAccount(provider: OAuthProvider, providerAccountId: string) {
      return database.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } }
      });
    },

    findByUserId(userId: string) {
      return database.account.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    },

    create(input: CreateAccountInput) {
      return database.account.create({ data: input });
    },

    createForNewUser({ user, ...account }: CreateAccountForNewUserInput) {
      return database.account.create({
        data: {
          ...account,
          user: { create: user }
        },
        include: { user: true }
      });
    }
  };
}

export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
