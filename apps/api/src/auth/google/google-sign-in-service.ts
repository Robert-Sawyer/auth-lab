import type { CompleteGoogleAuthorizationInput, GoogleIdentity } from "./google-oidc-client.js";
import type { ResolvedGoogleUser } from "./google-identity-resolver.js";

export type GoogleIdentityVerifier = {
  completeAuthorizationCode(input: CompleteGoogleAuthorizationInput): Promise<GoogleIdentity>;
};

export type GoogleUserResolver = {
  resolve(identity: GoogleIdentity): Promise<ResolvedGoogleUser>;
};

export class GoogleSignInService {
  public constructor(
    private readonly oidcClient: GoogleIdentityVerifier,
    private readonly identityResolver: GoogleUserResolver
  ) {}

  public async complete(input: CompleteGoogleAuthorizationInput): Promise<ResolvedGoogleUser> {
    const identity = await this.oidcClient.completeAuthorizationCode(input);

    return this.identityResolver.resolve(identity);
  }
}
