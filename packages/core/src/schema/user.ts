import type { SiteRole } from "../types.ts";

/** How a user authenticates. */
export type AuthProvider = "local" | "oidc" | "shared";

/** A user row. */
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: SiteRole;
  lastLoginAt: string | null;
  createdAt: string;
  /** Scrypt password hash for local accounts, null for SSO/shared users. */
  passwordHash?: string | null;
  /** User-edited display name that survives OIDC refresh, null if never edited. */
  displayNameOverride?: string | null;
  /** Which provider minted this identity. */
  authProvider?: AuthProvider;
  /** Whether the account is disabled (login rejected). */
  disabled?: boolean;
}
