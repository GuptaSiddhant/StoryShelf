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

A git channel is project-scoped and its event filter is fixed: it follows the build's state, not a topic list.

## Delivery contract

A `state` provider (`metadata.delivery: "state"`) creates an adapter with one method, `setState({ channel, target, state, url })`:

- `target: { kind: "status", sha, context, description? }` — set the commit status named exactly `context` (the caller owns the prefix; the provider adds nothing).
- `target: { kind: "comment", sha, markdown }` — create or update the one comment per build (keyed by a hidden marker built from `url`) on the pull request of the commit; skipped when the commit has no pull request.
- `state`: `pending`, `success` or `failure`.

Writes are idempotent and the latest call wins. A rejected write throws, and the host records the error on the channel row. Nothing is read from the git host during capture.

## Development

```sh
nub run build     # bundle with tsdown
nub run fmt       # format with oxfmt
nub run lint      # type-aware lint with oxlint
nub run test      # vitest suite (the *.live.test.ts files need LIVE_CLOUD=1 and tokens)
```

See [ADR 0014](../../docs/adr/0014-git-hosts-and-notifications.md).
