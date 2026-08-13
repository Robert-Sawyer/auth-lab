export class OAuthConfigurationError extends Error {
  public constructor() {
    super("Google OAuth is not configured.");
    this.name = "OAuthConfigurationError";
  }
}

export class OAuthCallbackError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OAuthCallbackError";
  }
}

export class AccountLinkRequiredError extends Error {
  public constructor() {
    super("This email belongs to an existing account that is not linked to Google.");
    this.name = "AccountLinkRequiredError";
  }
}
