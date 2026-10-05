# ADR 0019: Shared HTTP Helper in Core

## Status

Accepted

## Context

Outbound HTTP grew three uncoordinated shapes: `@octokit/rest` in `@storyshelf/git-github` (with built-in retry/throttle), hand-rolled `fetch` + `!res.ok` checks in `@storyshelf/git-gitlab`, and bespoke `postJson`/`postForm` helpers in the `storyshelf` CLI. No call site had timeouts, and only the Octokit path had any rate-limit resilience.

Removing `@octokit/rest` (dependency-trim decision: 6 REST calls don't justify the tree) would therefore silently regress rate-limit behavior on commit statuses — busy repositories hit GitHub secondary rate limits, producing flaky red checks with no retry. A shared helper is the single place to preserve retry/timeout semantics instead of copying them per package. An external micro-client (`ky`/`ofetch`) was rejected: the repo hand-rolls `fetch` everywhere and ~120 lines don't justify a new third-party dependency with ownership questions.

## Decision

1. **New `core/utils/http.ts`** (exported through the existing `./utils` entrypoint, no manifest changes): `httpJson<T>(url, options?)`, `HttpError` (`status` + body snippet), `HttpRequestOptions` (`method`, `headers`, `json`, `timeoutMs` default 30s via `AbortSignal.timeout`, `retries` default 3 attempts).
2. **Semantics**: non-2xx throws `HttpError`; retry only network failures, 429, and 502/503/504 (never other 4xx); honor `Retry-After` (capped at 30s), else 1s/2s/4s backoff; structured debug-per-attempt logging. No hooks/interceptors.
3. **Both git providers use it.** `git-github` ports its 6 Octokit calls; `git-gitlab` migrates its hand-rolled calls (preserving the lenient list-reads-return-`[]` behavior). Provider-specific URL/auth building stays local to each package.
4. **CLI migrates separately** (other workstream owns it); the helper awaits it.

## Consequences

- All outbound HTTP funnels through one tested implementation; rate-limit resilience survives the Octokit removal and extends to GitLab.
- New packages must use the helper (see Conventions) instead of adding client libraries — `ofetch`/`ky`-style dependencies should not appear in manifests.
- The helper's retry budget means slow failures take seconds (1s/2s/4s backoff); callers that must fail fast (e.g. existence probes) pass fewer retries or catch and degrade, as `findPrNumber`/`findMrIid` already do.
