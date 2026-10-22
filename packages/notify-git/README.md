# @storyshelf/notify-git

Git notification providers for StoryShelf: a `state` channel makes GitHub or GitLab show the current state of a build as a commit status (the merge gate) and a single pull-request or merge-request comment. Zero runtime dependencies — every call goes through `@storyshelf/core/utils` (`httpJson`: timeout + retry with `Retry-After`).

## Install

```sh
nub add @storyshelf/notify-git
```

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";
import { gitNotifiers } from "@storyshelf/notify-git";

const app = createShelfApp({ database, storage, notifications: { notifiers: gitNotifiers } });
```

`gitNotifiers` lists `gitHubNotifier` (`github`), `gitLabNotifier` (`gitlab`) and `gitLogNotifier` (`git-log`, writes to the server log). Combine it with other families: `notifiers: [...chatNotifiers, ...gitNotifiers]`.

Project admins then add a git channel on the project's **Notifications** settings page (or through `POST /api/v1/projects/{slug}/notification-channels`):

- `config`: `{ owner, repo, prefix? }` for GitHub; GitLab also takes `host` (self-managed hosts). `prefix` names the statuses (`<prefix>/testing`, default `storyshelf`); give each project that shares a repository its own prefix.
- `secret`: the token (GitHub: `repo:status`; GitLab: `api`), stored encrypted and decrypted in memory only at delivery time.
- GitHub only, `mode`: `statuses` (default; commit statuses with the token) or `checks` (check runs posted by a GitHub App). In `checks` mode `config` also holds `appId` and `installationId`, and the secret is the App's **private key** (PEM) instead of a token. The key is never returned by the API or shown in the UI. GitLab always uses commit statuses.

A git channel is project-scoped and its event filter is fixed: it follows the build's state, not a topic list.

## Providers

`gitNotifiers` aggregates all three providers:

| Provider kind | Writes to                                        | Use for                     |
| ------------- | ------------------------------------------------ | --------------------------- |
| `github`      | GitHub commit statuses and pull-request comments | GitHub.com repositories     |
| `gitlab`      | GitLab commit statuses and merge-request notes   | GitLab.com or self-managed  |
| `git-log`     | The server log                                   | Tests and local development |

The log provider's kind is `git-log` because `notify-chat` already owns `log`; provider kinds are unique across packages.

## Delivery contract

A `state` provider (`metadata.delivery: "state"`) creates an adapter with one method, `setState({ channel, target, state, url })`:

- `target: { kind: "status", sha, context, description? }` — set the commit status named exactly `context` (the caller owns the prefix; the provider adds nothing).
- `target: { kind: "comment", sha, markdown }` — create or update the one comment per build (keyed by a hidden marker built from `url`) on the pull request of the commit; skipped when the commit has no pull request.
- A status target may carry `progress` (`queued` | `running`, for a `pending` state), `informational`, `annotations` and `omitted` (see below). Providers that cannot show them ignore them.
- `state`: `pending`, `success`, `failure` or `cancelled`.

### GitHub check runs

In `checks` mode a status target becomes a **check run** named exactly `context` (so `storyshelf/testing` is still the name you require). The run mirrors the build: `queued` (not captured yet), `in_progress` (capturing, comparing, review open), then `completed` with `success`, `failure` or `cancelled`; the informational `<prefix>/storybook` run completes `neutral` instead of `failure`. Runs are keyed by commit SHA and the stable `external_id` `storyshelf:<context>`: an existing run is updated, never duplicated. The run's `details_url` is the absolute build URL. `<prefix>/testing` carries one **annotation** per `new` or `changed` snapshot, anchored at the story file, whose `raw_details` is that snapshot's review URL; they are posted in batches of 50 through check-run updates, at most 200 in total, and the summary says `and N more changed snapshots` with a link to the build. Annotations already on the run are skipped, so a repeated delivery adds nothing. The pure mapping lives in `github-check-mapper.ts`; nothing posts from a call site.

Authentication has no dependencies: the provider signs an RS256 JWT with `node:crypto`, exchanges it at `POST /app/installations/{id}/access_tokens` through `httpJson`, and caches the installation token per channel until five minutes before it expires. The pull-request comment uses the same token.

Writes are idempotent and the latest call wins. A rejected write throws, and the host records the error on the channel row. Nothing is read from the git host during capture.

## Direct use

Each provider is a `StateNotifierProvider` from `@storyshelf/core/adapter/notifier`. Bind one to a channel and call `setState`:

```ts
import { gitHubNotifier } from "@storyshelf/notify-git";

const adapter = gitHubNotifier.create({
  config: { owner: "acme", repo: "widgets" },
  secret: process.env.GITHUB_TOKEN,
});

await adapter.setState({
  channel,
  target: { kind: "status", sha, context: "storyshelf/testing", description: "Review closed" },
  state: "success",
  url: "https://shelf.example.com/projects/web/builds/01J...",
});
```

The status `context` is used verbatim: the caller owns the prefix, the provider adds nothing. StoryShelf derives the contexts, descriptions and links itself; direct use is for custom hosts. A `{ kind: "comment", sha, markdown }` target upserts the review comment instead.

## Development

```sh
nub run build     # bundle with tsdown
nub run fmt       # format with oxfmt
nub run lint      # type-aware lint with oxlint
nub run test      # vitest suite (the *.live.test.ts files need LIVE_CLOUD=1 and tokens)
```

See [ADR 0014](../../docs/adr/0014-git-hosts-and-notifications.md).
