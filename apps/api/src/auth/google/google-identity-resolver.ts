import {
  AccountsRepository,
  UsersRepository,
  type CreateUserInput,
  type OAuthProvider,
  type UserRole
} from "@auth-lab/database";

import { AccountLinkRequiredError, OAuthCallbackError } from "../errors.js";
import type { GoogleIdentity } from "./google-oidc-client.js";

const GOOGLE_PROVIDER: OAuthProvider = "GOOGLE";

export type ResolvedGoogleUser = {
  accountId: string;
  email: string;
  id: string;
  name: string | null;
  role: UserRole;
};

export class GoogleIdentityResolver {
  public constructor(
    private readonly users: UsersRepository,
    private readonly accounts: AccountsRepository
  ) {}

  public async resolve(identity: GoogleIdentity): Promise<ResolvedGoogleUser> {
    const existingAccount = await this.accounts.findByProviderAccount(
      GOOGLE_PROVIDER,
      identity.providerAccountId
    );

    if (existingAccount) {
      const user = await this.users.findById(existingAccount.userId);

      if (!user) {
        throw new OAuthCallbackError("Google account is not associated with an active user.");
      }

      return pickUser(user, existingAccount.id);
    }

    const existingUser = await this.users.findByEmail(identity.email);

    if (existingUser) {
      // Email equality alone is not sufficient proof that an external account may be linked.
      throw new AccountLinkRequiredError();
    }

    const account = await this.accounts.createForNewUser({
      provider: GOOGLE_PROVIDER,
      providerAccountId: identity.providerAccountId,
      providerEmail: identity.email,
      providerEmailVerified: true,
      user: createUserInput(identity)
    });

    return pickUser(account.user, account.id);
  }
}

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
