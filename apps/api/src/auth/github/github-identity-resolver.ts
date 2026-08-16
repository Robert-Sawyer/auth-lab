import type { AccountsRepository, UsersRepository } from "@auth-lab/database";

import {
  createOAuthIdentityService,
  type ResolvedOAuthUser
} from "../oauth-identity-service.js";
import type { GitHubIdentity } from "./github-oauth-client.js";

const GITHUB_PROVIDER = "GITHUB" as const;

export type ResolvedGitHubUser = ResolvedOAuthUser;

export function createGitHubIdentityResolver(users: UsersRepository, accounts: AccountsRepository) {
  const identities = createOAuthIdentityService(users, accounts);

  function toVerifiedIdentity(identity: GitHubIdentity) {
    return { ...identity, provider: GITHUB_PROVIDER };
  }

  return {
    linkToUser(userId: string, identity: GitHubIdentity): Promise<ResolvedGitHubUser> {
      return identities.linkToUser(userId, toVerifiedIdentity(identity));
    },
    resolve(identity: GitHubIdentity): Promise<ResolvedGitHubUser> {
      return identities.resolveSignIn(toVerifiedIdentity(identity));
    }
  };
}

export type GitHubIdentityResolver = ReturnType<typeof createGitHubIdentityResolver>;
