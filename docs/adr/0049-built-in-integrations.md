# ADR 0049: Built-in Integrations and Fewer Packages

## Status

Accepted (owner, 2026-11-10; proposed by the architect). The work lands on epic branch
`epic/878-built-in-integrations` (#878).

This ADR replaces decision 3 of ADR 0014 (three notification packages) and decision 3 of ADR 0018
(`@storyshelf/design-figma` as a package). It also changes the target of ADR 0048's push adapter. For
this work only, it lifts the "no adapter consolidation" line of the v1 package epic (#390).

## Context

StoryShelf publishes 22 packages. Several hold integrations that call a vendor's HTTP API and carry
no third-party dependency:

| Package                    | Lines | Third-party runtime dependencies |
| -------------------------- | ----- | -------------------------------- |
| `@storyshelf/notify-git`   | 1,400 | none (`fetch` through core)      |
| `@storyshelf/notify-chat`  | 230   | none                             |
| `@storyshelf/notify-email` | 270   | `nodemailer`, for SMTP only      |
| `@storyshelf/design-figma` | 390   | none                             |
| `notify-push` (ADR 0048)   | new   | none (node crypto)               |

ADR 0014 and ADR 0018 kept them out of core so that core would carry no provider code or SDKs
(ADR 0001). The SDK concern never materialised. The cost did:

- A project admin cannot connect Slack, GitLab or Figma unless the operator installed that package
  and redeployed.
- Every package is one more version, publish step, README and install line.

Two more packages are folds in all but name:

- `@storyshelf/image` (pixelmatch, pngjs, an optional `sharp` peer) is imported only by core, and core
  always depends on it.
- `@storyshelf/app` depends on `@storyshelf/observability` for two helpers, `currentTraceparent` and
  `captureMetrics`, that need only `@opentelemetry/api`. Every app install therefore also installs
  the OpenTelemetry Node SDK.

## Decision

### 1. Integrations are built in

- The git, chat, email, push and design integrations move into core under
  `packages/core/src/integrations/`:
  - `git/` (`github`, `gitlab`, `git-log`);
  - `chat/` (`slack-webhook`, `teams-workflow`, `log`);
  - `email/` (HTTP-API presets, `smtp`, `mailpit`, `log`);
  - `push/` (ADR 0048);
  - `design/figma/`.
- Core still imports no Hono. Each integration keeps its adapter shape (`NotifierProvider`,
  `EmailSender`, design provider) and its contract tests.
- Provider kinds stay unique across all integrations.

### 2. On by default, inactive until configured

- `createShelfApp` registers every built-in integration unless the options say otherwise.
- Registration sends nothing. An integration acts only when one of these is set up:
  - a project channel (`notification_channels`);
  - a design credential;
  - a personal subscription.
- Integrations that need an instance-wide secret stay off without it. The UI hides them then:
  - push needs VAPID keys (ADR 0048);
  - email needs a transport;
  - Figma OAuth needs a client id and secret. A personal Figma token still works without them.

### 3. Operators replace, add or remove

`notifications.notifiers`, `notifications.email` and `design` each accept:

- **an array:** exactly these, with no built-ins. This is today's behaviour, unchanged;
- **a function `(builtIn) => list`:** add a custom provider, replace a built-in of the same kind, or
  filter some out;
- **`false`:** none of that group.

The function form is resolved once at startup. A custom provider follows the same adapter contract as
a built-in one.

### 4. SMTP is the one optional dependency

- `nodemailer` becomes an optional peer dependency of core, loaded with a dynamic import only when an
  SMTP transport is configured.
- A missing peer fails at startup with an install hint.
- Hosting-only and edge runtimes never load it.

### 5. Every project-set URL passes the outbound guard

Built-in integrations make project-set URLs reachable on every install, so the outbound guard of #877
is a precondition of this epic:

- `https` only;
- no loopback, private, link-local or unique-local destination, checked after DNS resolution and on
  every redirect;
- an operator allowlist of exact hosts.

The guard applies to every request that sends to a URL a project configured:

- chat webhooks;
- GitLab hosts;
- project webhooks.

### 6. `@storyshelf/image` folds into core

- The codecs, worker pool and pixelmatch engine become an internal core module (`core/diff`).
- `sharp` stays an optional peer, now of core.
- The pixel comparison is unchanged.

### 7. The app no longer requires observability

- `currentTraceparent` and `captureMetrics` move into core; they use `@opentelemetry/api` only.
- `@storyshelf/app` drops its dependency on `@storyshelf/observability`.
- The observability package stays separate (#391). An operator installs it only to export telemetry.

### 8. Migration of the published packages

- For one minor release, each folded package is published as a thin re-export of core, marked
  deprecated in its README and its changeset. This covers:
  - `notify-git`, `notify-chat`, `notify-email`;
  - `design-figma`;
  - `image`.
- The release after that stops publishing them. The owner runs `npm deprecate` on each with a pointer
  to core.
- `notify-push` is never published.
- `storyshelf server init` stops generating imports and installs for them.
- The dev server and the Fly demo use the defaults.
- This is a breaking change, so a `minor` before 1.0 (ADR 0043).

## Rules that move unchanged

These rules come over from the packages as they are:

- Git state is posted only through `statusesForBuild` and `BuildStatePublisher`.
- The GitHub App private key is a channel secret. It never appears in config, logs, errors or API
  output.
- Every notification path calls `notificationOrigin(...)` first, and sends nothing without a confirmed
  origin.
- Push payloads carry only a title, one line and a relative path (ADR 0048).
- Outbound calls go through core's HTTP utilities. URLs are logged only as `redactUrlForLog`.

## Consequences

- **Packages:**
  - 22 → 17 published packages, after the one-minor transition;
  - 18 once `@storyshelf/server` (#367) ships;
  - 19 with `@storyshelf/storybook-addon` (ADR 0042).
- **For projects:** every project can connect git, chat, email, push and design tools without the
  operator redeploying.
- **For core:**
  - core grows by about 3,500 lines of integration code;
  - vendor API changes ship with core's weekly release, which all packages share anyway (ADR 0043);
  - `integrations/` keeps the code out of the domain modules.
- **For installs:** a default app install no longer pulls in the OpenTelemetry Node SDK.
- **For third parties:** they still write providers against the same contracts and pass them through
  the function form.

## Amendment 2026-11-20: offered only when available (#1126)

Owner, 2026-11-16: a project never shows an integration the server does not support or has turned
off. Built-ins are still registered, but offered to projects only when available.

- A notifier or design provider may declare `availability()`: `available`, or
  `{ unavailable: reason }`. Absent means available. It is evaluated once at startup
  (`offerIntegrations` in `resolveShelfOptions`); the app registers only available providers and
  keeps a status for every kind.
- The built-in `email` notifier is unavailable until a transport replaces it. Figma is available
  (personal tokens); its OAuth button still needs the client id and secret. Git stays available
  until ADR 0054's connections land, when it follows the server's connection (#1119).
- `SHELF_INTEGRATIONS_DISABLED` (`integrationsFromEnv`) turns kinds off without code, for the
  server image and the Fly demo. A built-in kind missing after resolution reads as turned off.
- Project settings, the channel API and MCP offer only available kinds; creating one of another
  kind answers 400 with the reason. A stored channel of such a kind is kept, hidden from its project
  and not delivered to; the System page lists it with the reason. No schema change, no deletion.
- The System page and the site-admin deep health list every integration as available,
  unavailable (reason) or turned off. Site admins see one line in a project's settings in place of
  what is missing; project admins see nothing.

## Amendment 2026-11-21: the packaging rule and local storage (#1241)

Owner, 2026-11-20 and 2026-11-21. `@storyshelf/storage-local` (146 lines, depends only on core,
needed by almost every server) is built into core as `@storyshelf/core/storage/local`; the factory
and options are unchanged, and core's `exports` map gains that one subpath. It adds no dependency.
`@storyshelf/storage-local` stays for one minor release as a deprecated re-export with a notice,
then is no longer published (a `Breaking:` changeset at removal). A scaffold from `server init`
imports core and lists no storage package for local.

The amendment also records the test for every later "fold into core or keep as a package" call.

### The packaging rule

1. **Core** holds what every server needs, plus built-in features whose own code is light. A
   third-party dependency of such a feature is an optional peer of core, loaded only when the
   feature is used: email uses `nodemailer`, images use `sharp`, and the database drivers are
   optional peers of `@storyshelf/db` (#1242).
2. **A separate package** is right when any of these holds:
   - the concern is optional and its dependencies are heavy enough that they must never enter a
     server or serverless bundle unused: cloud storage SDKs (`storage`, one optional peer per
     subpath), the OpenTelemetry Node SDK (`observability`), the AI SDK (`ai`), the auth engine
     (`auth`), Playwright (`runner`). Related backends with heavy SDKs share **one** package, one
     subpath and one optional peer each, not a package per vendor;
   - its version is a user-visible contract: the runner pins the browser, and the browser decides
     the baselines;
   - it runs in another runtime or process: the CLI, the Storybook addon, the MCP server;
   - it is a layer core must not depend on: `app` (Hono);
   - it is shared by core and the CLI, which must not depend on core: `affected`;
   - it is **a layer core is built on**, with its own test infrastructure and no imports from core:
     `db` (persistence: tables, dialects, migrations, drivers). This mirrors `app` and needs both
     halves; code that only _could_ be a lower layer stays in core.
3. **Retiring.** A package folded into core is published as a deprecated re-export for **one minor
   release**, then no longer published. The owner runs `npm deprecate` on it. Until 2027-01-01 the
   amendment "No shims until 2027" below applies instead: no re-export is published at all.
4. **Built in does not mean closed.** The adapter interfaces (`StorageAdapter`, `CaptureRunner`,
   notifier and design providers) stay the extension points. The database is the exception:
   dialects are built into `@storyshelf/db`, so `DatabaseAdapter` stops being a third-party
   extension point. A new SQL dialect is a contribution to `@storyshelf/db`; a new driver for an
   existing dialect plugs in through its public driver entry point (#1242). The databases move
   under #1242 once ADR 0041 task 5 lands; until then `db-{sqlite,postgres,mysql}` stay as they are.

### Audit and target

The audit of every package (2026-11-20) found these follow the rule: `core`, `app`, `cli`,
`affected`, `auth`, `ai`, `mcp`, `observability`, `storybook-addon`. The rest change:

- **`runner-playwright` becomes `@storyshelf/runner`** in 0.15.0 (#1295). It is the only runner once
  Puppeteer is gone and stays separate because its version is a user-visible contract.
- **`storage-{s3,gcs,azure}` become one `@storyshelf/storage`** (#1294) with `/s3`, `/gcs` and
  `/azure` subpaths, each cloud SDK an optional peer that only its own subpath loads (the shape of
  `@storyshelf/db`), plus `/local`, a re-export of core's built-in local storage, so every backend is
  importable from one place. The implementation stays in core. The SDKs stay: they provide
  credential chains (IRSA, workload identity, managed identity), signing and multipart uploads that
  StoryShelf must not reimplement.
- **`storage-local`** moves into core (this amendment), `db-{sqlite,postgres,mysql}` into one `db`
  package (#1242), and `runner-puppeteer` is removed (deprecated in 0.14.0 by #1243, removed in
  0.15.0 by #1244).
- **Overdue:** the shims `notify-{git,chat,email}`, `design-figma` and `image` shipped as re-exports
  in 0.13.0 and stop being published in 0.14.0 (#1245).

The target is 12 packages: `core`, `app`, `cli`, `db`, `storage`, `runner`, `auth`, `ai`,
`observability`, `mcp`, `affected`, `storybook-addon`.

## Amendment 2026-11-21: no shims until 2027 (#1309)

Owner, 2026-11-21: "Till 2026, all breaking changes are allowed so no need to support old packages,
env vars and properties or columns." This changes rule 3 (Retiring) for every release before
**2027-01-01**, the public launch:

- A renamed or folded package is not published again. The release that moves it deletes it, with a
  `Breaking:` changeset naming the new path. There is no deprecated re-export.
- The owner runs `npm deprecate` on the old name after that release, with a message that names the
  new package or path.
- `@storyshelf/storage-local` follows this: it was never published as a re-export, and the
  "one minor release" sentence of the amendment above does not apply to it.

From 2027-01-01 rule 3 applies again: one minor release as a deprecated re-export, then no longer
published. ADR 0053 has the matching amendment for the schema.

## Amendment 2026-11-21: `@storyshelf/db` lands above core (#1331)

The owner brought the packaging part of #1242 forward, so the rename lands before the no-shim window
closes on 2027-01-01. `db-{sqlite,postgres,mysql}` are folded into one `@storyshelf/db` with `/sqlite`,
`/postgres` and `/mysql` subpaths and the existing presets under each, and every driver is an optional
peer that only its own subpath loads. The move changes no code and no schema. `ddl`, `schema` and
`drizzle-factory` are no longer published (ADR 0041 replaces them).

Until #1242 inverts the layering, the package sits **above** core: it imports core's adapter
interfaces, models and test helpers, which is the reverse of the target in rule 2. The inversion, with
core building on `@storyshelf/db`, stays in #1242 and still waits for ADR 0041 task 5.

## Amendment 2026-11-21: testing-only libraries follow the runner (#1335)

Folding `@storyshelf/image` into core made a hosting-only deployment (no `testing` option) install
libraries it never loads: `axe-core` (3.1 MB), `pngjs` (0.7 MB) and `pixelmatch`. The image _code_ stays
in core; its _libraries_ move to the package a testing deployment already needs:

- `axe-core` is a `@storyshelf/runner` dependency. `axeInjectionScript` and `loadAxeSource` live in the
  runner (`a11y-source.ts`); core keeps the a11y types, the in-page helpers and the stored-result readers.
- `pngjs` and `pixelmatch` are optional peers of core, used only by `./diff`, and runner `dependencies`,
  so a testing install gets them. `./diff` imports them lazily on first use, never at module load;
  `verifyImageEngine` runs only with `testing`, and a missing peer fails readiness with a message naming
  it and the install line. `sharp` is unchanged (optional peer).

## Alternatives considered

- **Keep the packages (ADR 0014, ADR 0018).** Rejected: the SDK risk they guarded against is absent,
  and per-project setup without a redeploy matters more.
- **One `@storyshelf/notify` package with subpaths.** Rejected by the owner: it still needs the
  operator to install it, and it saves less.
- **Built in, but off by default.** Rejected: projects would still depend on an operator change. With
  the outbound guard in place, on-but-unconfigured is safe.
- **Put the integrations in the app.** Rejected: the notify queue, git state and capture jobs that call
  them live in core.
