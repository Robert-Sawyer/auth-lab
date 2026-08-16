import type {
  CompleteGitHubAuthorizationInput,
  GitHubIdentity
} from "./github-oauth-client.js";
import type { ResolvedGitHubUser } from "./github-identity-resolver.js";

export type GitHubIdentityVerifier = {
  completeAuthorizationCode(input: CompleteGitHubAuthorizationInput): Promise<GitHubIdentity>;
};

export type GitHubUserResolver = {
  linkToUser(userId: string, identity: GitHubIdentity): Promise<ResolvedGitHubUser>;
  resolve(identity: GitHubIdentity): Promise<ResolvedGitHubUser>;
};

export function createGitHubSignInService(
  oauthClient: GitHubIdentityVerifier,
  identityResolver: GitHubUserResolver
) {
  async function complete(input: CompleteGitHubAuthorizationInput): Promise<ResolvedGitHubUser> {
    const identity = await oauthClient.completeAuthorizationCode(input);

    return identityResolver.resolve(identity);
  }

  async function link(
    userId: string,
    input: CompleteGitHubAuthorizationInput
  ): Promise<ResolvedGitHubUser> {
    const identity = await oauthClient.completeAuthorizationCode(input);

    return identityResolver.linkToUser(userId, identity);
  }

  return { complete, link };
}

export type GitHubSignInService = ReturnType<typeof createGitHubSignInService>;
