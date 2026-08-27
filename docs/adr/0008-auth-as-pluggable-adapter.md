# ADR 0008: Auth as a Pluggable Adapter

## Status

Accepted

## Context

StoryShelf is a self-hosted tool that may be deployed behind a VPN (no auth needed), exposed publicly (auth required), or integrated into an enterprise environment with existing identity providers (OAuth, SAML, LDAP, Keycloak, Authentik, Okta, etc.).

The auth model must handle two distinct concerns:
1. **Web UI authentication** — who is the logged-in user? (session-based)
2. **CLI authentication** — which project is this build for? (token-based, already in the entity model)

Enterprise self-hosted services should use the organization's existing auth, not a proprietary auth system. The auth layer must be pluggable.

## Decision

Auth is an adapter interface, like every other concern in StoryShelf. The core application never imports concrete auth implementations.

### AuthAdapter interface

```typescript
interface AuthAdapter {
  /** Check if request is authenticated. Returns user or null. */
  check(request: Request): Promise<AuthUser | null>;

  /** Create a session after successful login. Returns cookie value. */
  createSession(user: AuthUser): Promise<string>;

  /** Destroy a session (logout). */
  destroySession(sessionId: string): Promise<void>;

  /** Resolve OAuth/SSO callback into a user. */
  handleCallback(callback: AuthCallback): Promise<AuthUser | null>;
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: "admin" | "member";   // SITE-level role only; project roles live in project_members
}

interface AuthCallback {
  provider: string;
  code: string;
  state: string;
}
```

### How auth integrates with the app

The main router mounts auth middleware and routes:

```typescript
// middleware: check auth on every request (except API tokens and auth routes)
app.use("*", async (c, next) => {
  // API tokens bypass session auth (CLI uses Authorization header)
  if (c.req.header("authorization")) return next();

  // Auth routes are always accessible
  if (c.req.path.startsWith("/auth/")) return next();

  const user = await auth.check(c.req.raw);
  if (!user) {
    return c.redirect("/auth/login");
  }

  c.set("user", user);
  return next();
});

// Auth routes (provided by the auth adapter's implementation)
app.get("/auth/login", ...);      // redirect to OAuth provider
app.get("/auth/callback", ...);   // handle OAuth callback
app.post("/auth/logout", ...);    // destroy session
```

### Auth route mounting

The `createShelfRouter` factory mounts auth routes based on the configured adapter:

```typescript
if (options.auth) {
  // Auth adapter provides its own route handlers
  app.route("/auth", options.auth.routes());
}
```

### Three auth modes

| Mode | Config | Who it's for |
|------|--------|-------------|
| **None** (default) | No `auth` adapter passed | Local dev, VPN-protected networks. All requests are anonymous. |
| **Shared password** | `createPasswordAuth({ password: env.AUTH_PASSWORD })` | Small teams. Single password set via env var. Simple but no per-user identity. |
| **OAuth/OIDC** | `createOAuthAuth({ issuer, clientId, clientSecret })` | Enterprise. Plugs into Keycloak, Authentik, Okta, GitHub, GitLab, Google, etc. |

### OAuth/OIDC adapter (built-in)

The OAuth adapter uses the standard authorization code flow:

```
1. User visits /auth/login
2. Adapter redirects to provider's /authorize endpoint
3. Provider authenticates user, redirects to /auth/callback
4. Adapter exchanges code for tokens, fetches user info
5. Adapter creates session, sets cookie
6. User is authenticated
```

```typescript
import { createOAuthAuth } from "@storyshelf/auth-oauth";

const auth = createOAuthAuth({
  issuer: process.env.OIDC_ISSUER,         // "https://keycloak.example.com/realms/myteam"
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  // Optional:
  scopes: ["openid", "profile", "email"],
  roleMapping: (claims) => {
    // Map provider claims to the SITE-LEVEL role only.
    // Project roles are assigned in-app via project_members.
    if (claims.groups?.includes("admins")) return "admin";
    return "member";
  },
});
```

### API token auth (CLI)

CLI authentication uses API tokens — already in the entity model. This is separate from user auth:

```
CLI request:
  Authorization: Bearer shelf_TOK_01JDXyz...

Server:
  1. Check Authorization header → extract token
  2. Hash token, look up in tokens table
  3. Identify project from token
  4. Proceed (no user identity needed for CLI operations)
```

Token auth runs **before** session auth middleware. If an `Authorization` header is present, the session check is skipped.

### Session management

Sessions are stored in encrypted cookies (not in the database):

```typescript
interface SessionConfig {
  secret: string;           // HMAC signing key (from env SECRET)
  maxAge: number;           // cookie lifetime (default: 7 days)
  secure: boolean;          // HTTPS-only (default: true in production)
  httpOnly: boolean;        // no JS access (always true)
  sameSite: "lax" | "strict";
}
```

The session cookie contains: `{ userId, email, role, expiresAt }` — signed with HMAC, not encrypted. The cookie is tamper-proof but readable (no PII beyond what's needed). For stronger privacy, encrypt with AES-256-GCM before signing.

### User model (optional)

If the auth adapter provides user identity, StoryShelf stores a lightweight user record:

The `users` and `project_members` tables are defined once in `docs/architecture.md` (Entity Model); the Drizzle definitions mirror them 1:1.

This record is created/updated on each login (upsert). It's optional — if no auth adapter is configured, no user records exist.

### Authentication vs. authorization

- **Authentication** (who are you?) comes from the IdP via OIDC; any employee can log in.
- **Authorization** (what can you do, and on which project?) lives in StoryShelf as per-project membership.

The OAuth adapter's `roleMapping` maps IdP claims to the **site-level** role only (`admin` or `member`). Project roles are assigned in-app on the project settings page. This avoids forcing the IdP to maintain StoryShelf-specific groups for every team/role combination.

### Project-scoped roles

Four roles, ordered by capability, assigned per project via `project_members`:

- **admin** — full control over that project: review, members, tokens, webhooks, and project settings.
- **approver** — can review (approve/reject snapshots) and re-run builds, but not manage members/tokens/settings.
- **developer** — can view and re-run/trigger builds, but cannot approve/reject.
- **viewer** — read-only.

| Action | admin | approver | developer | viewer | anonymous |
|--------|-------|----------|-----------|--------|-----------|
| View builds and diffs | ✓ | ✓ | ✓ | ✓ | ✗ (✓ if build public) |
| View published Storybook | ✓ | ✓ | ✓ | ✓ | ✓ if build public |
| Re-run / retry builds | ✓ | ✓ | ✓ | ✗ | ✗ |
| Comment on builds/snapshots | ✓ | ✓ | ✓ | ✗ | ✗ |
| Approve/reject snapshots | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create/delete projects | site admin | ✗ | ✗ | ✗ | ✗ |
| Manage members | ✓ (project) | ✗ | ✗ | ✗ | ✗ |
| Manage tokens | ✓ (project) | ✗ | ✗ | ✗ | ✗ |
| Manage webhooks | ✓ (project) | ✗ | ✗ | ✗ | ✗ |
| Server settings | site admin | ✗ | ✗ | ✗ | ✗ |

Effective role resolution:

```typescript
function effectiveRole(user, project): "admin" | "approver" | "developer" | "viewer" | null {
  if (user.role === "admin") return "admin";                       // site admin sees all projects
  return projectMembers.find((m) => m.userId === user.id)?.role ?? null; // null = no access
}
```

A non-admin user must have a `project_members` row to access a project at all. When no auth adapter is configured, all operations are permitted (development mode).

> The split between **approver** and **developer** exists to support the Git-provider merge gate (ADR 0010): developers push and re-run builds, while a separate set of approvers is the only group that can green-light a merge by accepting snapshots. Anonymous access is limited to published Storybook builds marked public (ADR 0011).

## Consequences

**Positive:**
- Enterprise teams plug in their existing IdP (Keycloak, Authentik, Okta, GitHub)
- Small teams use shared password or no auth behind VPN
- CLI auth (tokens) is independent of user auth (sessions) — no coupling
- Auth adapter is ~300 LOC, not a framework dependency
- The app never imports passport.js, next-auth, or any auth library directly

**Negative:**
- Session management adds complexity (cookie signing, secure flags, expiry)
- OAuth flow requires redirect handling (but this is standard Hono middleware)
- Role mapping from external providers requires configuration (but sensible defaults help)

## Why Not an Auth Library (passport.js, lucia, etc.)

- **passport.js**: Node.js-specific, middleware-based, doesn't compose well with Hono's typed context
- **lucia**: Great for Next.js/Remix, but opinionated about database schema and session storage
- **Better-auth**: Modern, but adds a framework dependency

A custom AuthAdapter is ~300 LOC and gives full control. The OAuth/OIDC flow is well-specified (RFC 6749, OpenID Connect Core). The session is a signed cookie. There's no need for a framework dependency to do what's essentially 3 HTTP redirects + a cookie.
