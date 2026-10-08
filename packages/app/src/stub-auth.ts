import type { Auth } from "@storyshelf/core/auth";
import type { AuthUser } from "@storyshelf/core/types";

/* oxlint-disable typescript/promise-function-async -- stub returns pre-resolved promises */

/**
 * Test-only Auth stub: `check` resolves the given user; every other method
 * is an inert default (overridable per test).
 */
export function stubAuth(user: AuthUser | null, overrides?: Partial<Auth>): Auth {
  return {
    handler: () => Promise.resolve(new Response("Not Found", { status: 404 })),
    loginMethods: () => [],
    setup: () => Promise.resolve(),
    issueInvite: () => Promise.reject(new Error("stub auth cannot issue invites")),
    verifyInvite: () => Promise.reject(new Error("stub auth cannot verify invites")),
    acceptInvite: () => Promise.reject(new Error("stub auth cannot accept invites")),
    passkeysEnabled: () => false,
    listSessions: () => Promise.resolve([]),
    listPasskeys: () => Promise.resolve([]),
    hasPassword: () => Promise.resolve(false),
    setDisabled: () => Promise.resolve(),
    check: () => Promise.resolve(user),
    createSession: () => Promise.resolve("ok"),
    destroySession: () => Promise.resolve(),
    ...overrides,
  };
}
