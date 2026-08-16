import { describe, expect, it, vi } from "vitest";

import type { AccountsRepository, UsersRepository } from "@auth-lab/database";

import { createGitHubIdentityResolver } from "../src/auth/github/github-identity-resolver.js";

const identity = {
  providerAccountId: "42",
  email: "person@example.com",
  name: "Ada Lovelace",
  imageUrl: "https://example.com/avatar.png"
};

describe("createGitHubIdentityResolver", () => {
  it("does not sign in through a matching local email until the account is explicitly linked", async () => {
    const users = {
      findByEmail: vi.fn().mockResolvedValue({ id: "existing-user" }),
      findById: vi.fn()
    };
    const accounts = {
      create: vi.fn(),
      createForNewUser: vi.fn(),
      findByProviderAccount: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn()
    };
    const resolver = createGitHubIdentityResolver(
      users as unknown as UsersRepository,
      accounts as unknown as AccountsRepository
    );

    await expect(resolver.resolve(identity)).rejects.toMatchObject({ code: "ACCOUNT_LINK_REQUIRED" });
    expect(accounts.createForNewUser).not.toHaveBeenCalled();
  });

  it("links a newly verified GitHub identity only to the authenticated user", async () => {
    const user = { id: "user-1", email: identity.email, name: identity.name, role: "USER" };
    const users = {
      findByEmail: vi.fn(),
      findById: vi.fn().mockResolvedValue(user)
    };
    const accounts = {
      create: vi.fn().mockResolvedValue({ id: "github-account-id" }),
      createForNewUser: vi.fn(),
      findByProviderAccount: vi.fn().mockResolvedValue(null),
      findByUserId: vi.fn()
    };
    const resolver = createGitHubIdentityResolver(
      users as unknown as UsersRepository,
      accounts as unknown as AccountsRepository
    );

    await expect(resolver.linkToUser("user-1", identity)).resolves.toEqual({
      ...user,
      accountId: "github-account-id"
    });
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(accounts.create).toHaveBeenCalledWith({
      provider: "GITHUB",
      providerAccountId: identity.providerAccountId,
      providerEmail: identity.email,
      providerEmailVerified: true,
      userId: "user-1"
    });
  });

  it("refuses to attach a GitHub account that belongs to another user", async () => {
    const users = {
      findByEmail: vi.fn(),
      findById: vi.fn()
    };
    const accounts = {
      create: vi.fn(),
      createForNewUser: vi.fn(),
      findByProviderAccount: vi.fn().mockResolvedValue({ id: "github-account-id", userId: "other-user" }),
      findByUserId: vi.fn()
    };
    const resolver = createGitHubIdentityResolver(
      users as unknown as UsersRepository,
      accounts as unknown as AccountsRepository
    );

    await expect(resolver.linkToUser("user-1", identity)).rejects.toMatchObject({
      code: "OAUTH_CALLBACK_FAILED"
    });
    expect(accounts.create).not.toHaveBeenCalled();
  });
});
