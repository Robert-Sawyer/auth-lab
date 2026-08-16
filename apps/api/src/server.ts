import {
  createAccountsRepository,
  createPrismaClient,
  createUsersRepository
} from "@auth-lab/database";

import { createGoogleIdentityResolver } from "./auth/google/google-identity-resolver.js";
import { createGoogleOidcClient } from "./auth/google/google-oidc-client.js";
import { createGoogleSignInService } from "./auth/google/google-sign-in-service.js";
import { createGitHubIdentityResolver } from "./auth/github/github-identity-resolver.js";
import { createGitHubOAuthClient } from "./auth/github/github-oauth-client.js";
import { createGitHubSignInService } from "./auth/github/github-sign-in-service.js";
import { createOAuthIdentityService } from "./auth/oauth-identity-service.js";
import { createSessionLifecycleService } from "./auth/session/session-lifecycle-service.js";
import { createSessionManagementService } from "./auth/session/session-management-service.js";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const database = config.databaseUrl ? createPrismaClient(config.databaseUrl) : undefined;
const users = database ? createUsersRepository(database) : undefined;
const accounts = database ? createAccountsRepository(database) : undefined;
const accountLinking = users && accounts ? createOAuthIdentityService(users, accounts) : undefined;
const googleIdentityResolver = users && accounts
  ? createGoogleIdentityResolver(users, accounts)
  : undefined;
const githubIdentityResolver = users && accounts
  ? createGitHubIdentityResolver(users, accounts)
  : undefined;
const sessionLifecycle = database
  ? createSessionLifecycleService({
      accessTokenSecret: config.accessTokenSecret,
      accessTokenTtlSeconds: config.accessTokenTtlSeconds,
      database,
      refreshTokenPepper: config.refreshTokenPepper,
      sessionTtlDays: config.sessionTtlDays
    })
  : undefined;
const sessionManagement = database ? createSessionManagementService(database) : undefined;
const app = createApp({
  accountLinking,
  webOrigin: config.webOrigin,
  oauthTransactionCookieSecret: config.oauthTransactionCookieSecret,
  secureCookies: config.isProduction,
  getGitHubOAuthConfig: config.getGitHubOAuthConfig,
  getGoogleOAuthConfig: config.getGoogleOAuthConfig,
  sessionLifecycle,
  sessionManagement,
  completeGoogleSignIn: googleIdentityResolver
    ? {
        complete: (input) =>
          createGoogleSignInService(
            createGoogleOidcClient(config.getGoogleOAuthConfig()),
            googleIdentityResolver
          ).complete(input)
      }
    : undefined,
  completeGitHubSignIn: githubIdentityResolver
    ? {
        complete: (input) =>
          createGitHubSignInService(
            createGitHubOAuthClient(config.getGitHubOAuthConfig()),
            githubIdentityResolver
          ).complete(input),
        link: (userId, input) =>
          createGitHubSignInService(
            createGitHubOAuthClient(config.getGitHubOAuthConfig()),
            githubIdentityResolver
          ).link(userId, input)
      }
    : undefined
});

if (database) {
  app.addHook("onClose", async () => database.$disconnect());
}

async function start() {
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function stop(signal: NodeJS.Signals) {
  app.log.info({ signal }, "Stopping API server");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

void start();
