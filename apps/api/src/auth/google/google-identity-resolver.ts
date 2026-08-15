import {
  type AccountsRepository,
  type UsersRepository,
  type CreateUserInput,
  type OAuthProvider,
  type UserRole
} from "@auth-lab/database";

import { createAccountLinkRequiredError, createOAuthCallbackError } from "../errors.js";
import type { GoogleIdentity } from "./google-oidc-client.js";

const GOOGLE_PROVIDER: OAuthProvider = "GOOGLE";

export type ResolvedGoogleUser = {
  accountId: string;
  email: string;
  id: string;
  name: string | null;
  role: UserRole;
};

export function createGoogleIdentityResolver(users: UsersRepository, accounts: AccountsRepository) {
  return {
    async resolve(identity: GoogleIdentity): Promise<ResolvedGoogleUser> {
      const existingAccount = await accounts.findByProviderAccount(
        GOOGLE_PROVIDER,
        identity.providerAccountId
      );

      if (existingAccount) {
        const user = await users.findById(existingAccount.userId);

        if (!user) {
          throw createOAuthCallbackError("Google account is not associated with an active user.");
        }

        return pickUser(user, existingAccount.id);
      }

      const existingUser = await users.findByEmail(identity.email);

      if (existingUser) {
        // Email equality alone is not sufficient proof that an external account may be linked.
        throw createAccountLinkRequiredError();
      }

      const account = await accounts.createForNewUser({
        provider: GOOGLE_PROVIDER,
        providerAccountId: identity.providerAccountId,
        providerEmail: identity.email,
        providerEmailVerified: true,
        user: createUserInput(identity)
      });

      return pickUser(account.user, account.id);
    }
  };
}

export type GoogleIdentityResolver = ReturnType<typeof createGoogleIdentityResolver>;

function createUserInput(identity: GoogleIdentity): CreateUserInput {
  return {
    email: identity.email,
    emailVerifiedAt: new Date(),
    name: identity.name,
    imageUrl: identity.imageUrl
  };
}

function pickUser(
  user: Pick<ResolvedGoogleUser, "email" | "id" | "name" | "role">,
  accountId: string
): ResolvedGoogleUser {
  return { accountId, id: user.id, email: user.email, name: user.name, role: user.role };
}
