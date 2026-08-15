import type { CompleteGoogleAuthorizationInput, GoogleIdentity } from "./google-oidc-client.js";
import type { ResolvedGoogleUser } from "./google-identity-resolver.js";

export type GoogleIdentityVerifier = {
  completeAuthorizationCode(input: CompleteGoogleAuthorizationInput): Promise<GoogleIdentity>;
};

export type GoogleUserResolver = {
  resolve(identity: GoogleIdentity): Promise<ResolvedGoogleUser>;
};

export function createGoogleSignInService(
  oidcClient: GoogleIdentityVerifier,
  identityResolver: GoogleUserResolver
) {
  return {
    async complete(input: CompleteGoogleAuthorizationInput): Promise<ResolvedGoogleUser> {
      const identity = await oidcClient.completeAuthorizationCode(input);

      return identityResolver.resolve(identity);
    }
  };
}

export type GoogleSignInService = ReturnType<typeof createGoogleSignInService>;
