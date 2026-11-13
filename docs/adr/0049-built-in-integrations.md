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

## Alternatives considered

- **Keep the packages (ADR 0014, ADR 0018).** Rejected: the SDK risk they guarded against is absent,
  and per-project setup without a redeploy matters more.
- **One `@storyshelf/notify` package with subpaths.** Rejected by the owner: it still needs the
  operator to install it, and it saves less.
- **Built in, but off by default.** Rejected: projects would still depend on an operator change. With
  the outbound guard in place, on-but-unconfigured is safe.
- **Put the integrations in the app.** Rejected: the notify queue, git state and capture jobs that call
  them live in core.
