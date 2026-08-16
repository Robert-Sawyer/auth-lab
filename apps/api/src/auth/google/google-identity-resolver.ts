import {
  type AccountsRepository,
  type UsersRepository
} from "@auth-lab/database";

import {
  createOAuthIdentityService,
  type ResolvedOAuthUser
} from "../oauth-identity-service.js";
import type { GoogleIdentity } from "./google-oidc-client.js";

export type ResolvedGoogleUser = ResolvedOAuthUser;

export function createGoogleIdentityResolver(users: UsersRepository, accounts: AccountsRepository) {
  const identities = createOAuthIdentityService(users, accounts);

  return {
    async resolve(identity: GoogleIdentity): Promise<ResolvedGoogleUser> {
      return identities.resolveSignIn({
        ...identity,
        provider: GOOGLE_PROVIDER,
        providerAccountId: identity.providerAccountId
      });
    }
  };
}

export type GoogleIdentityResolver = ReturnType<typeof createGoogleIdentityResolver>;

const GOOGLE_PROVIDER = "GOOGLE" as const;
