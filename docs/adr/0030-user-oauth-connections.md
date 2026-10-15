# ADR 0030: User OAuth Connections ("Connect your account")

Status: accepted

## Context

Design previews need a credential. The project token (ADR 0029) is shared and always wins, but a project without one shows only deep links. Members could lend their own access, as Jira/Linear integrations do ("Connect your account"), and Jira, Linear and similar adapters will want the same flow later. Building it Figma-specific inside the design code would be redone for each of them.

## Decision

1. **Service-neutral contract.** `@storyshelf/core/adapter/oauth` defines `OAuthClient` (`authorizeUrl`, `exchangeCode`, `refresh`) and `OAuthConnectable` (an adapter with `metadata.{kind,name}` and an optional `oauth`). An adapter holds its operator-registered client id/secret itself (`createFigmaDesign({ oauth })`, `figmaOAuthFromEnv()`); with no `oauth` the service is not connectable and no prompt appears.
2. **One shared flow in the app.** `GET /connections/:service/start`, `GET /connections/:service/callback`, `POST /connections/:service/disconnect` serve every connectable service. `connectableServices()` (`app/src/connections.ts`) lists them; a new adapter kind joins by being added there. The flow needs auth enabled (a user to own the connection) and `config.secret`.
3. **Signed, browser-bound state.** `state` is an HMAC-signed, 10-minute payload (`userId`, `service`, `returnTo`, nonce); the nonce is also an `HttpOnly` cookie. The callback requires a valid signature, the same service, the same signed-in user and the matching cookie; the return path must be a same-site path.
4. **Per-user storage.** `user_connections(user_id, service, token_encrypted, refresh_token_encrypted, expires_at, status)` with a unique `(user_id, service)`; tokens are encrypted with the credential keys and included in secret rotation. `ConnectionModel.accessToken` refreshes lazily and once per connection per process when the token is within a minute of expiry; a failed refresh sets `status = expired` until the user reconnects.
5. **Used only on the owner's visit.** A member's token is never used by background work. A page view by that member fetches with it.
6. **Design precedence and visibility.** The project credential wins; a member's connection is used only when the project has none, and only for that member. Entries fetched that way are stored with `design_nodes.viewer_id = user` (renders under `.../user-<id>/...`) and are served only to that user, including the render route, so a private file's preview never reaches someone without access. No admin switch to forbid member connections (not needed: a project token takes precedence).

## Consequences

- Jira/Linear/etc. need only an `oauth` client on their adapter plus a line in `connectableServices()`; storage, refresh, state signing and routes are reused.
- Figma issues one access token per app per user, so a refresh invalidates the previous token; the in-process lock prevents concurrent refreshes in one process but not across several app instances (a rare race that ends in `expired` and a reconnect).
- `design_credentials` holds only the project-wide token (user connections live in `user_connections`); the reserved per-user columns from ADR 0029 were dropped.
