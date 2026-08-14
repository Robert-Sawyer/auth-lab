import { describe, expect, it, vi } from "vitest";

import { AccountsRepository, UsersRepository } from "@auth-lab/database";

import { AccountLinkRequiredError } from "../src/auth/errors.js";
import { GoogleIdentityResolver } from "../src/auth/google/google-identity-resolver.js";

const identity = {
  providerAccountId: "google-subject-123",
  email: "person@example.com",
  name: "Ada Lovelace",
  imageUrl: "https://example.com/avatar.png"
};

describe("GoogleIdentityResolver", () => {
  it("returns the user already linked to a Google provider account", async () => {
    const users = {
      findByEmail: vi.fn(),
      findById: vi
        .fn()
        .mockResolvedValue({ id: "user-id", email: identity.email, name: identity.name, role: "USER" })
    };
    const accounts = {
      createForNewUser: vi.fn(),
      findByProviderAccount: vi.fn().mockResolvedValue({ id: "google-account-id", userId: "user-id" })
    };
    const resolver = new GoogleIdentityResolver(
      users as unknown as UsersRepository,
      accounts as unknown as AccountsRepository
    );

    await expect(resolver.resolve(identity)).resolves.toEqual({
      accountId: "google-account-id",
      id: "user-id",
      email: identity.email,
      name: identity.name,
      role: "USER"
    });
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(accounts.createForNewUser).not.toHaveBeenCalled();
  });

  it("does not link Google to an existing user based on email alone", async () => {
    const users = {
      findByEmail: vi.fn().mockResolvedValue({ id: "existing-user" }),
      findById: vi.fn()
    };
    const accounts = {
      createForNewUser: vi.fn(),
      findByProviderAccount: vi.fn().mockResolvedValue(null)
    };
    const resolver = new GoogleIdentityResolver(
      users as unknown as UsersRepository,
      accounts as unknown as AccountsRepository
    );

    await expect(resolver.resolve(identity)).rejects.toBeInstanceOf(AccountLinkRequiredError);
    expect(accounts.createForNewUser).not.toHaveBeenCalled();
  });

  it("creates the user and provider account atomically for a new identity", async () => {
    const createdUser = { id: "new-user", email: identity.email, name: identity.name, role: "USER" };
    const users = {
      findByEmail: vi.fn().mockResolvedValue(null),
      findById: vi.fn()
    };
    const accounts = {
      createForNewUser: vi.fn().mockResolvedValue({ id: "new-google-account", user: createdUser }),
      findByProviderAccount: vi.fn().mockResolvedValue(null)
    };
    const resolver = new GoogleIdentityResolver(
      users as unknown as UsersRepository,
      accounts as unknown as AccountsRepository
    );

    await expect(resolver.resolve(identity)).resolves.toEqual({
      ...createdUser,
      accountId: "new-google-account"
    });
    expect(accounts.createForNewUser).toHaveBeenCalledWith({
      provider: "GOOGLE",
      providerAccountId: identity.providerAccountId,
      providerEmail: identity.email,
      providerEmailVerified: true,
      user: {
        email: identity.email,
        emailVerifiedAt: expect.any(Date),
        imageUrl: identity.imageUrl,
        name: identity.name
      }
    });
  });
});
