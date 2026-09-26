import type { AuthAdapter, AuthUser } from "@storyshelf/core/adapter/auth";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";

/** Options for configuring an account-based auth adapter (invite-only). */
export interface AccountAuthOptions {
  /** Database adapter (must have users + userInviteTokens tables). */
  db: DatabaseAdapter;
  /** Secret used to sign and verify session cookies. */
  secret: string;
  /** Invite expiry, ms (default 7 days). */
  inviteExpiryMs?: number;
}

/** Auth adapter that manages local email/password accounts via invites. */
export interface AccountAuth extends AuthAdapter {
  /** Verify email+password and return a session token. */
  loginWithCredentials(email: string, password: string): Promise<string>;
  /**
   * Invite a user by email (admin only). Creates the user if needed, supersedes
   * prior unused invites, and returns the one-time token (shown once).
   */
  issueInvite(input: { email: string; name: string; role: AuthUser["role"] }): Promise<{
    inviteId: string;
    token: string;
    expiresAt: string;
  }>;
  /**
   * Accept an invite: verify the token, set the initial password, and return
   * the created user. Token is single-use. Fails with generic error on any
   * invalid/expired/reused token to avoid oracles.
   */
  acceptInvite(input: { inviteId: string; token: string; password: string }): Promise<AuthUser>;
  /** Change a user's own password (verifies current). */
  changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void>;
  /** Disable or re-enable a user (admin). */
  setDisabled(userId: string, disabled: boolean): Promise<void>;
}
