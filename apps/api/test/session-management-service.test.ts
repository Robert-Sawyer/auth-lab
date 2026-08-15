import { describe, expect, it, vi } from "vitest";

import type { AuthDatabaseClient } from "@auth-lab/database";

import { createSessionManagementService } from "../src/auth/session/session-management-service.js";

const now = new Date("2026-08-15T10:00:00.000Z");

describe("createSessionManagementService", () => {
  it("maps active sessions and identifies the session bound to the access token", async () => {
    const database = createDatabase({ revokedSessionCount: 1 });
    database.session.findMany.mockResolvedValue([
      {
        account: { provider: "GOOGLE" },
        createdAt: now,
        expiresAt: new Date("2026-09-14T10:00:00.000Z"),
        id: "current-session",
        ipAddress: "127.0.0.1",
        lastActivityAt: now,
        userAgent: "Vitest"
      }
    ]);
    const service = createSessionManagementService(database.client, () => now);

    await expect(service.listActiveSessions("user-1", "current-session")).resolves.toEqual([
      {
        createdAt: now,
        expiresAt: new Date("2026-09-14T10:00:00.000Z"),
        id: "current-session",
        ipAddress: "127.0.0.1",
        isCurrent: true,
        lastActivityAt: now,
        provider: "GOOGLE",
        userAgent: "Vitest"
      }
    ]);
  });

  it("revokes refresh tokens only after the selected user-owned session was revoked", async () => {
    const database = createDatabase({ revokedSessionCount: 1 });
    const service = createSessionManagementService(database.client, () => now);

    await expect(service.revokeSessionForUser("session-1", "user-1")).resolves.toBe(true);
    expect(database.session.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { account: { userId: "user-1" }, id: "session-1", revokedAt: null }
    });
    expect(database.refreshToken.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { revokedAt: null, sessionId: "session-1" }
    });
  });

  it("does not revoke any refresh token when the target session is absent or not owned by the user", async () => {
    const database = createDatabase({ revokedSessionCount: 0 });
    const service = createSessionManagementService(database.client, () => now);

    await expect(service.revokeSessionForUser("other-user-session", "user-1")).resolves.toBe(false);
    expect(database.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("revokes every active session and refresh token belonging to a user", async () => {
    const database = createDatabase({ revokedSessionCount: 2 });
    const service = createSessionManagementService(database.client, () => now);

    await expect(service.revokeAllSessionsForUser("user-1")).resolves.toBe(2);
    expect(database.refreshToken.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { revokedAt: null, session: { account: { userId: "user-1" } } }
    });
  });
});

function createDatabase({ revokedSessionCount }: { revokedSessionCount: number }) {
  const client = {
    $transaction: async <Result>(callback: (transaction: unknown) => Promise<Result>) => callback(client),
    refreshToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    session: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: revokedSessionCount })
    }
  };

  return {
    client: client as unknown as AuthDatabaseClient,
    refreshToken: client.refreshToken,
    session: client.session
  };
}
