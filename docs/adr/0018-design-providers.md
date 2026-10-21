# ADR 0018: Design Providers

## Status

Accepted

Supersedes (archived): ADR 0029

## Context

Design-tool support (Figma) started as vendor-specific code inside core and the app: URL parsing, the
REST client, cache tables and settings copy. Every other vendor concern is an adapter (ADR 0001
Architecture and Conventions, for example git hosts and notifiers), and per-user OAuth for a design
tool would add more vendor code (callback route, token refresh) to core. Operators who do not use Figma
should not carry it.

## Decision

1. **`DesignProvider` adapter** (`@storyshelf/core/adapter/design`, category `design`). A provider
   supplies only vendor specifics: `parseUrl` (validate a pasted link into `{fileKey, nodeId, url}`),
   `create({credential})` returning a client with batched `fetchMetas` and `fetchRenders`, and metadata
   describing its credential (label, help text, placeholder, URL hint, maximum age). Failures map to a
   per-ref `DesignState` instead of throwing.
2. **Core stays vendor-neutral.** Link resolution (manual mapping over story parameters), the
   metadata and render cache (`DesignNodeModel`, `DesignRenderStore`), staleness and credential-age
   rules, credential storage (`DesignCredentialModel`), the render route and all UI live in core and the
   app, and take the provider list from `createShelfApp({ design })`. The app holds the providers; there
   are no remote workers (ADR 0006 Testing Option, Hosting-Only Mode and the Database Queue).
3. **`@storyshelf/design-figma`** is the first provider (`createFigmaDesign()`): a URL parser and a
   batched metadata and render client on the shared `httpJson` and `httpBytes` helpers, with 90-day
   credential metadata.
4. **Opt-in.** Servers pass `design: [createFigmaDesign()]`; the dev server, the Fly demo and
   `storyshelf server init` are wired. With no provider nothing is extracted or shown, and the Design
   settings tab explains how to add one.
5. **Provider-aware schema.** `design_nodes` (with `provider` and `viewer_id`) caches metadata and
   renders; `design_credentials` (with `provider`) holds credentials. `viewer_id` is `''` for the
   project scope (not NULL) so the unique index holds on every dialect. Cache entries fetched with a
   user's own access carry that `viewer_id` and are served only to that user; user connections live in
   their own table (ADR 0011 Authentication and Access).
6. **Story parameter.** The explicit per-story link is `parameters.storyshelf.figma`. A provider-neutral
   key can be added alongside it when a second provider exists.
7. **Per-story links need recorded parameters.** Per-story design links come from the parameters a
   capture records. Without `testing` there are no recorded parameters (the published catalog,
   `index.json`, carries none), so per-story design links are empty: the component page shows the
   project-level design links only, and review shows the story without a design beside it. Nothing
   treats the absence as an error, and nothing in review depends on a design (ADR 0013 UI Review).
   Design renders are class `testing`.

## Alternatives considered

| Option                                                            | Why not                                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Keep Figma in core                                                | Per-user OAuth and any second tool would keep growing vendor code in core and break the adapter convention |
| Model other tools now (Penpot, Zeplin)                            | Speculative; the contract is only what Figma needs (parse, metadata, renders, credential copy)             |
| Read parameters from the embedded preview in the viewer's browser | Depends on Storybook's internal channel across versions 8 to 10                                            |

## Consequences

- Per-user OAuth is a provider capability plus core connection and cache-visibility logic.
- Deployments wire the provider explicitly.
- One more published package (`@storyshelf/design-figma`) to version and document.
