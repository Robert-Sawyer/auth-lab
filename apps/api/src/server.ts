import { AccountsRepository, createPrismaClient, UsersRepository } from "@auth-lab/database";

import { GoogleIdentityResolver } from "./auth/google/google-identity-resolver.js";
import { GoogleOidcClient } from "./auth/google/google-oidc-client.js";
import { GoogleSignInService } from "./auth/google/google-sign-in-service.js";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const database = config.databaseUrl ? createPrismaClient(config.databaseUrl) : undefined;
const googleIdentityResolver = database
  ? new GoogleIdentityResolver(new UsersRepository(database), new AccountsRepository(database))
  : undefined;
const app = createApp({
  webOrigin: config.webOrigin,
  oauthTransactionCookieSecret: config.oauthTransactionCookieSecret,
  secureCookies: config.isProduction,
  getGoogleOAuthConfig: config.getGoogleOAuthConfig,
  completeGoogleSignIn: googleIdentityResolver
    ? {
        complete: (input) =>
          new GoogleSignInService(
            new GoogleOidcClient(config.getGoogleOAuthConfig()),
            googleIdentityResolver
          ).complete(input)
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
