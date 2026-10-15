# ADR 0029: Design Provider Adapter (`@storyshelf/design-figma`)

## Status

Accepted

## Context

Figma support (#141) landed as Figma-specific code inside core and the app: URL parsing, the REST client, `figma_nodes`/`design_tokens` tables and settings copy. Every other vendor concern is an adapter (ADR 0001: `git-host`, `notifier`, `capture-queue`, …), and the next feature — per-user Figma OAuth — would add yet more vendor code (callback route, token refresh) to core. Operators who do not use Figma also carry it.

## Decision

1. **`DesignProvider` adapter** (`@storyshelf/core/adapter/design`, category `design`). A provider supplies only vendor specifics: `parseUrl` (validate a pasted link into `{fileKey, nodeId, url}`), `create({credential})` → a client with batched `fetchMetas` / `fetchRenders`, and metadata describing its credential (label, help text, placeholder, URL hint, max age). Failures map to a per-ref `DesignState` instead of throwing.
2. **Core stays vendor-neutral.** Link resolution (manual mapping > story parameters), the metadata/render cache (`DesignNodeModel`, `DesignRenderStore`), staleness and credential-age rules, credential storage (`DesignCredentialModel`), the render route and all UI live in core/app and take the provider list from `createShelfApp({ design })`. Remote workers take the same list so capture validates declared links.
3. **`@storyshelf/design-figma`** is the first provider (`createFigmaDesign()`): URL parser, batched metadata/render client on the shared `httpJson`/`httpBytes` helpers (ADR 0019), 90-day credential metadata.
4. **Opt-in.** Servers pass `design: [createFigmaDesign()]` (as with `gitHosts`); the dev server, Fly demo and `storyshelf server init` are wired. With no provider nothing is extracted or shown, and the Design settings tab explains how to add one.
5. **Schema renamed and made provider-aware.** `figma_nodes` → `design_nodes` (+ `provider`, `viewer_id`), `design_tokens` → `design_credentials` (+ `provider`, `user_id`, `auth_type`, `refresh_token_encrypted`, `expires_at`). `user_id`/`viewer_id` use `''` for the project scope (not NULL) so the unique indexes hold on every dialect. **Reserved space for per-user connections:** a personal OAuth connection is a `design_credentials` row with the user's id, and cache entries fetched with a user's own access carry that `viewer_id`, so they can be served only to that user. This release uses only the `''` scope.
6. **Breaking change, no data migration** (agreed up front): old `figma_nodes`/`design_tokens` tables are dropped on startup (the cache refetches itself); the Figma token must be re-entered once; the component page tab `?tab=figma` is now `?tab=design`; existing servers must add `design: [createFigmaDesign()]`.
7. The explicit story parameter keeps its name (`parameters.storyshelf.figma`); a provider-neutral key can be added alongside it when a second provider exists.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep Figma in core | OAuth and any second tool would keep growing vendor code in core; breaks the adapter convention |
| Model other tools now (Penpot, Zeplin) | Speculative; the contract is deliberately only what Figma needs (parse, metadata, renders, credential copy) |
| Data-copy migration | Cache is disposable and the credential is one paste; breaking changes were allowed |

## Consequences

- Per-user OAuth becomes a provider capability plus core credential/cache-visibility logic with no further table changes.
- Existing deployments must wire the provider and re-enter the Figma token.
- One more published package (`@storyshelf/design-figma`) to version and document.
