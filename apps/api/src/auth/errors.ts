type AuthErrorCode =
  | "ACCOUNT_LINK_REQUIRED"
  | "OAUTH_CALLBACK_FAILED"
  | "OAUTH_CONFIGURATION_MISSING";

type AuthError<Code extends AuthErrorCode> = Error & { code: Code };

export function createOAuthConfigurationError(provider = "OAuth"): AuthError<"OAUTH_CONFIGURATION_MISSING"> {
  return createAuthError("OAUTH_CONFIGURATION_MISSING", `${provider} is not configured.`);
}

export function createOAuthCallbackError(message: string): AuthError<"OAUTH_CALLBACK_FAILED"> {
  return createAuthError("OAUTH_CALLBACK_FAILED", message);
}

export function createAccountLinkRequiredError(provider: string): AuthError<"ACCOUNT_LINK_REQUIRED"> {
  return createAuthError(
    "ACCOUNT_LINK_REQUIRED",
    `This email belongs to an existing account that is not linked to ${provider}.`
  );
}

export function isOAuthConfigurationError(error: unknown): error is AuthError<"OAUTH_CONFIGURATION_MISSING"> {
  return isAuthError(error, "OAUTH_CONFIGURATION_MISSING");
}

export function isOAuthCallbackError(error: unknown): error is AuthError<"OAUTH_CALLBACK_FAILED"> {
  return isAuthError(error, "OAUTH_CALLBACK_FAILED");
}

export function isAccountLinkRequiredError(error: unknown): error is AuthError<"ACCOUNT_LINK_REQUIRED"> {
  return isAuthError(error, "ACCOUNT_LINK_REQUIRED");
}

function createAuthError<Code extends AuthErrorCode>(code: Code, message: string): AuthError<Code> {
  return Object.assign(new Error(message), { code, name: code });
}

function isAuthError<Code extends AuthErrorCode>(error: unknown, code: Code): error is AuthError<Code> {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
