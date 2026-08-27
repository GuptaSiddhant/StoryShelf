import type { ProjectRole, SiteRole } from "../types.ts";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: SiteRole;
}

export interface AuthCallback {
  provider: string;
  code: string;
  state: string;
}

export interface ProjectAccess {
  role: ProjectRole;
}

export interface AuthAdapter {
  check(request: Request): Promise<AuthUser | null>;
  createSession(user: AuthUser): Promise<string>;
  destroySession(sessionId: string): Promise<void>;
  handleCallback?(callback: AuthCallback): Promise<AuthUser | null>;
}
