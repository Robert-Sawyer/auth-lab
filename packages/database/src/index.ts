export { createPrismaClient } from "./client.js";
export { AccountsRepository } from "./repositories/accounts-repository.js";
export { RefreshTokensRepository } from "./repositories/refresh-tokens-repository.js";
export { SessionsRepository } from "./repositories/sessions-repository.js";
export { UsersRepository } from "./repositories/users-repository.js";
export { OAuthProvider, UserRole } from "./generated/prisma/client.js";
export type {
  AuthDatabase,
  AuthDatabaseClient,
  CreateAccountForNewUserInput,
  CreateAccountInput,
  CreateRefreshTokenInput,
  CreateSessionInput,
  CreateUserInput
} from "./repositories/types.js";
