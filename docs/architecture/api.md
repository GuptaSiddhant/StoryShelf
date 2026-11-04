# API

> Part of the [StoryShelf architecture spec](./README.md).

## API Design

All JSON endpoints under `/api/v1`. HTML pages at `/`. HTML and published-Storybook routes address projects by their `slug`; JSON endpoints use the ULID `id`.

```
# Projects
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId

# Builds
GET    /api/v1/projects/:projectId/builds
POST   /api/v1/projects/:projectId/builds          # multipart: storybook zip + sha/branch/message/author -> 202
GET    /api/v1/projects/:projectId/builds/:buildId
POST   /api/v1/projects/:projectId/builds/:buildId/retry   # re-run capture (flaky tests)
POST   /api/v1/projects/:projectId/builds/:buildId/cancel  # cancel the build's jobs of every kind; the build ends cancelled (class testing)
DELETE /api/v1/projects/:projectId/builds/:buildId

# Snapshots (read-only API, mutations via review endpoints)
GET    /api/v1/projects/:projectId/builds/:buildId/snapshots

# Attempts (per-build capture history; one row per run, same build ID)
GET    /api/v1/projects/:projectId/builds/:buildId/attempts
GET    /api/v1/projects/:projectId/builds/:buildId/attempts/:attemptNo
GET    /api/v1/projects/:projectId/builds/:buildId/attempts/:attemptNo/logs

# Review
POST   /api/v1/projects/:projectId/builds/:buildId/snapshots/:snapshotId/approve
POST   /api/v1/projects/:projectId/builds/:buildId/snapshots/:snapshotId/reject
POST   /api/v1/projects/:projectId/builds/:buildId/approve-all
POST   /api/v1/projects/:projectId/builds/:buildId/reject-all

# Comments
GET    /api/v1/projects/:projectId/builds/:buildId/comments
POST   /api/v1/projects/:projectId/builds/:buildId/comments         # { body, snapshotId? | storyId?, parentId? }
POST   /api/v1/projects/:projectId/builds/:buildId/comments/:commentId/resolve
GET    /api/v1/projects/:projectId/builds/:buildId/reviews          # verdicts and where the build stands (404 with review off)
POST   /api/v1/projects/:projectId/builds/:buildId/reviews          # { verdict: approved|rejected, body? } (approver, admin)

# Labels
GET    /api/v1/projects/:projectId/label-types                      # list label types
POST   /api/v1/projects/:projectId/label-types                      # create type { key, name, linkTemplate, color }
PATCH  /api/v1/projects/:projectId/label-types/:key
DELETE /api/v1/projects/:projectId/label-types/:key
GET    /api/v1/projects/:projectId/builds?label=:key::value         # filter builds by label

# Tokens
GET    /api/v1/projects/:projectId/tokens
POST   /api/v1/projects/:projectId/tokens
DELETE /api/v1/projects/:projectId/tokens/:tokenId

# Members (project-scoped RBAC; project admin or site admin)
GET    /api/v1/projects/:projectId/members
POST   /api/v1/projects/:projectId/members          # { userId, role }
PATCH  /api/v1/projects/:projectId/members/:userId  # change role
DELETE /api/v1/projects/:projectId/members/:userId

# Baseline portability (zip: manifest.json + PNGs, format v1)
GET    /api/v1/projects/:slug/baselines/export?branch=  # stream archive (viewer+)
POST   /api/v1/projects/:slug/baselines/import          # application/zip body, upsert (approver+)

# Publishing
POST   /api/v1/projects/:projectId/builds/:buildId/publish     # mark build publicly viewable
POST   /api/v1/projects/:projectId/builds/:buildId/unpublish

# Admin
POST   /api/v1/admin/purge                          # manual retention purge

# Auth (Better Auth engine, mounted at /api/auth/*; see https://www.better-auth.com/docs/integrations/hono)
ALL    /api/auth/*                     # Better Auth handler (email+password, social, SSO, passkey, sessions)
GET    /auth/login                     # descriptor-driven method list, or redirect for sole oauth/sso
GET    /auth/engine/:providerId        # start one oauth/sso flow
POST   /auth/engine/login              # local account login (email + password → engine)
GET    /auth/invites/:inviteId         # set-password form for an invite link (?token=…)
POST   /auth/invites/:inviteId         # accept invite, set credential, land on /profile
POST   /auth/logout                    # destroy session (plus engine sign-out)

# Relying-party helpers (public, auth-gate-exempt)
GET    /.well-known/openid-configuration  # RP metadata: issuer, redirect_uris, providers (not an IdP)
GET    /.well-known/change-password       # 302 to /profile

# UI Pages
GET    /                                                   # projects list
GET    /projects/create
POST   /projects/create
GET    /projects/:slug                                    # project overview (recent builds, labels)
GET    /projects/:slug/builds                             # builds list (filter by branch/status/label)
GET    /projects/:slug/builds/:buildId                    # build review page (diff + comments + labels)
GET    /projects/:slug/labels                             # label types (config)
GET    /projects/:slug/labels/:key/:value                 # label page (`:value` wildcard, URL-encoded)
GET    /projects/:slug/storybook                          # published Storybook (default branch)
GET    /projects/:slug/storybook/:key/:value              # published Storybook (`:value` wildcard, URL-encoded)
GET    /projects/:slug/storybook/build/:buildId/...       # published Storybook (specific build; serves assets)
GET    /projects/:slug/settings                           # members, label types, public access, tokens, webhooks
GET    /profile                                           # personal page: name, password (local), memberships
POST   /profile                                           # update display name override
POST   /profile/password                                  # change local-account password
GET    /admin                                             # site-admin System page (adapter inventory + in-depth health)
```
