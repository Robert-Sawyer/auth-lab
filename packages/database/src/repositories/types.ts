import type { OAuthProvider, PrismaClient, UserRole } from "../generated/prisma/client.js";

export type AuthDatabase = Pick<PrismaClient, "user" | "account" | "session" | "refreshToken">;

export type AuthDatabaseClient = AuthDatabase & Pick<PrismaClient, "$transaction">;

export type CreateUserInput = {
  email: string;
  emailVerifiedAt?: Date | null;
  imageUrl?: string | null;
  name?: string | null;
  role?: UserRole;
};

export type CreateAccountInput = {
  provider: OAuthProvider;
  providerAccountId: string;
  providerEmail?: string | null;
  providerEmailVerified?: boolean;
  userId: string;
};

export type CreateAccountForNewUserInput = Omit<CreateAccountInput, "userId"> & {
  user: CreateUserInput;
};

export type CreateSessionInput = {
  accountId: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type CreateRefreshTokenInput = {
  expiresAt: Date;
  familyId: string;
  id?: string;
  sessionId: string;
  tokenHash: string;
};
