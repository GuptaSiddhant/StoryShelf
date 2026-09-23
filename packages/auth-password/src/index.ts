import type { AuthAdapter, AuthUser } from "@storyshelf/core/adapter/auth";
import { timingSafeEqual } from "node:crypto";
import { createSessionHandlers } from "./session.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a shared-password auth adapter.
 *
 * @param options - Password and session signing configuration.
 * @returns A PasswordAuth instance.
 */
const SHARED_ADMIN_USER: AuthUser = {
  id: "shared",
  email: "admin@local",
  name: "Admin",
  role: "admin",
};
const SHARED_VIEWER_USER: AuthUser = {
  id: "shared-viewer",
  email: "viewer@local",
  name: "Viewer",
  role: "viewer",
};

export function createPasswordAuth(options: PasswordAuthOptions): PasswordAuth {
  const { password, viewerPassword, secret } = options;
  const sessions = createSessionHandlers(secret);

  const login = async (input: string, user?: AuthUser): Promise<string> => {
    if (equalStrings(input, password)) {
      return await sessions.createSession(user ?? SHARED_ADMIN_USER);
    }
    if (viewerPassword !== undefined && equalStrings(input, viewerPassword)) {
      return await sessions.createSession(SHARED_VIEWER_USER);
    }
    throw new Error("Invalid password");
  };

  return {
    metadata: {
      name: "Password Auth",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Shared-password auth adapter",
      kind: "password",
      category: "auth",
    },
    lifecycle: buildLifecycle(options),
    check: sessions.check,
    createSession: sessions.createSession,
    async destroySession() {
      await Promise.resolve();
    },
    login,
  };
}

/** Options for configuring a shared-password auth adapter. */
export interface PasswordAuthOptions {
  /** The shared password users must present to log in (admin when tiered). */
  password: string;
  /** Optional viewer-tier password — when set, enables tiered mode: `password` → admin, `viewerPassword` → viewer. */
  viewerPassword?: string;
  /** Secret used to sign and verify session cookies. */
  secret: string;
}

/** Auth adapter that authenticates with a single shared password (or tiered admin/viewer when `viewerPassword` is set). */
export interface PasswordAuth extends AuthAdapter {
  /** Verify `password` and, if correct, create a session for `user` (or the built-in tiered user), returning a session token. */
  login(password: string, user?: AuthUser): Promise<string>;
}

function equalStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Lifecycle: fail fast when password or secret is missing (tiered viewer password validated when present). */
function buildLifecycle(options: PasswordAuthOptions): PasswordAuth["lifecycle"] {
  return {
    setup: async () => {
      if (options.password === "" || options.secret === "") {
        throw new Error("Password auth requires a non-empty password and secret");
      }
      if (options.viewerPassword !== undefined && options.viewerPassword === "") {
        throw new Error("Password auth viewerPassword must be non-empty when set");
      }
      await Promise.resolve();
    },
    teardown: async () => {
      // Stateless — nothing to destroy.
      await Promise.resolve();
    },
    health: async () => {
      await Promise.resolve();
      return { ok: true };
    },
  };
}
