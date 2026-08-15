import { describe, expect, it, vi } from "vitest";

import { createAccountsRepository } from "../src/repositories/accounts-repository.js";
import { createRefreshTokensRepository } from "../src/repositories/refresh-tokens-repository.js";
import { createSessionsRepository } from "../src/repositories/sessions-repository.js";
import { createUsersRepository } from "../src/repositories/users-repository.js";
import type { AuthDatabase } from "../src/repositories/types.js";

function createDatabaseMock() {
  return {
    user: {
      create: vi.fn(),
      findUnique: vi.fn()
    },
    account: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn()
    },
    session: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn()
    }
  };
}

function asAuthDatabase(database: ReturnType<typeof createDatabaseMock>): AuthDatabase {
  // Repository tests only exercise the Prisma delegate methods used by each repository.
  return database as unknown as AuthDatabase;
}

describe("database repositories", () => {
  const now = new Date("2026-08-12T10:00:00.000Z");

  it("keeps user identity separate from a provider account", () => {
    const database = createDatabaseMock();
    const authDatabase = asAuthDatabase(database);
    const users = createUsersRepository(authDatabase);
    const accounts = createAccountsRepository(authDatabase);

    users.create({ email: "person@example.com", name: "Ada Lovelace" });
    accounts.create({
      userId: "c4e4af60-1e53-4541-b6fa-03bac9c381b5",
      provider: "GOOGLE",
      providerAccountId: "google-subject-123",
      providerEmail: "person@example.com",
      providerEmailVerified: true
    });

    expect(database.user.create).toHaveBeenCalledWith({
      data: { email: "person@example.com", name: "Ada Lovelace" }
    });
    expect(database.account.create).toHaveBeenCalledWith({
      data: {
        userId: "c4e4af60-1e53-4541-b6fa-03bac9c381b5",
        provider: "GOOGLE",
        providerAccountId: "google-subject-123",
        providerEmail: "person@example.com",
        providerEmailVerified: true
      }
    });
  });

  it("looks up accounts using the provider-specific compound key", () => {
    const database = createDatabaseMock();
    const accounts = createAccountsRepository(asAuthDatabase(database));

    accounts.findByProviderAccount("GITHUB", "octocat-42");

    expect(database.account.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerAccountId: { provider: "GITHUB", providerAccountId: "octocat-42" }
      }
    });
  });

  it("only lists sessions that belong to the user and are still active", () => {
    const database = createDatabaseMock();
    const sessions = createSessionsRepository(asAuthDatabase(database), () => now);

    sessions.listActiveForUser("c4e4af60-1e53-4541-b6fa-03bac9c381b5");

    expect(database.session.findMany).toHaveBeenCalledWith({
      where: {
        account: { userId: "c4e4af60-1e53-4541-b6fa-03bac9c381b5" },
        revokedAt: null,
        expiresAt: { gt: now }
      },
      include: { account: true },
      orderBy: { lastActivityAt: "desc" }
    });
  });

  it("consumes a refresh token only when it has not been used, revoked, or expired", () => {
    const database = createDatabaseMock();
    const refreshTokens = createRefreshTokensRepository(asAuthDatabase(database), () => now);

    refreshTokens.markUsedAndReplaced(
      "965cce33-3be9-4fe1-8a26-7de3e9e156ee",
      "f7116b06-b592-4d0e-a157-48a73422fe47"
    );

    expect(database.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "965cce33-3be9-4fe1-8a26-7de3e9e156ee",
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now }
      },
      data: {
        usedAt: now,
        replacedByTokenId: "f7116b06-b592-4d0e-a157-48a73422fe47"
      }
    });
  });

  it("revokes every refresh token that belongs to a user's sessions", () => {
    const database = createDatabaseMock();
    const refreshTokens = createRefreshTokensRepository(asAuthDatabase(database), () => now);

    refreshTokens.revokeForUser("c4e4af60-1e53-4541-b6fa-03bac9c381b5");

    expect(database.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        session: { account: { userId: "c4e4af60-1e53-4541-b6fa-03bac9c381b5" } },
        revokedAt: null
      },
      data: { revokedAt: now }
    });
  });
});
