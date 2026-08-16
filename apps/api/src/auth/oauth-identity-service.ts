import type {
  AccountsRepository,
  CreateUserInput,
  OAuthProvider,
  UserRole,
  UsersRepository
} from "@auth-lab/database";

import { createAccountLinkRequiredError, createOAuthCallbackError } from "./errors.js";

export type VerifiedOAuthIdentity = {
  email: string;
  imageUrl: string | null;
  name: string | null;
  provider: OAuthProvider;
  providerAccountId: string;
};

export type ResolvedOAuthUser = {
  accountId: string;
  email: string;
  id: string;
  name: string | null;
  role: UserRole;
};

export type LinkedProviderAccount = {
  createdAt: Date;
  provider: OAuthProvider;
  providerEmail: string | null;
  providerEmailVerified: boolean;
};

export function createOAuthIdentityService(users: UsersRepository, accounts: AccountsRepository) {
  async function resolveSignIn(identity: VerifiedOAuthIdentity): Promise<ResolvedOAuthUser> {
    const existingAccount = await accounts.findByProviderAccount(
      identity.provider,
      identity.providerAccountId
    );

    if (existingAccount) {
      const user = await users.findById(existingAccount.userId);

      if (!user) {
        throw createOAuthCallbackError("The provider account is not associated with an active user.");
      }

      return pickUser(user, existingAccount.id);
    }

    const existingUser = await users.findByEmail(identity.email);

    if (existingUser) {
      // A matching email does not prove control of the authenticated local account.
      throw createAccountLinkRequiredError(toProviderName(identity.provider));
    }

    const account = await accounts.createForNewUser({
      provider: identity.provider,
      providerAccountId: identity.providerAccountId,
      providerEmail: identity.email,
      providerEmailVerified: true,
      user: createUserInput(identity)
    });

    return pickUser(account.user, account.id);
  }

  async function linkToUser(userId: string, identity: VerifiedOAuthIdentity): Promise<ResolvedOAuthUser> {
    const existingAccount = await accounts.findByProviderAccount(
      identity.provider,
      identity.providerAccountId
    );

    if (existingAccount) {
      if (existingAccount.userId !== userId) {
        throw createOAuthCallbackError("This provider account is already linked to another user.");
      }

      const user = await users.findById(userId);

      if (!user) {
        throw createOAuthCallbackError("The authenticated user no longer exists.");
      }

      return pickUser(user, existingAccount.id);
    }

    const user = await users.findById(userId);

    if (!user) {
      throw createOAuthCallbackError("The authenticated user no longer exists.");
    }

    const account = await accounts.create({
      provider: identity.provider,
      providerAccountId: identity.providerAccountId,
      providerEmail: identity.email,
      providerEmailVerified: true,
      userId
    });

    return pickUser(user, account.id);
  }

  async function listLinkedAccounts(userId: string): Promise<LinkedProviderAccount[]> {
    const linkedAccounts = await accounts.findByUserId(userId);

    return linkedAccounts.map((account) => ({
      createdAt: account.createdAt,
      provider: account.provider,
      providerEmail: account.providerEmail,
      providerEmailVerified: account.providerEmailVerified
    }));
  }

  return { linkToUser, listLinkedAccounts, resolveSignIn };
}

export type OAuthIdentityService = ReturnType<typeof createOAuthIdentityService>;

function createUserInput(identity: VerifiedOAuthIdentity): CreateUserInput {
  return {
    email: identity.email,
    emailVerifiedAt: new Date(),
    imageUrl: identity.imageUrl,
    name: identity.name
  };
}

function pickUser(
  user: Pick<ResolvedOAuthUser, "email" | "id" | "name" | "role">,
  accountId: string
): ResolvedOAuthUser {
  return { accountId, id: user.id, email: user.email, name: user.name, role: user.role };
}

function toProviderName(provider: OAuthProvider): string {
  return provider === "GITHUB" ? "GitHub" : "Google";
}
