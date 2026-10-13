---
title: Uploading without git
description: Use StoryShelf from checkouts without git — synthetic identity, environment branches, and checkout-less pipelines.
---

StoryShelf works without git. `sha` and `branch` are opaque strings throughout the system — git is one convenient source of them, not a requirement. The server never executes git, and the CLI degrades gracefully when no repository is present.

## Identity resolution

`upload` resolves each field independently — **flags > env > local git > synthesized**:

| Priority | `--sha` | `--branch` |
|----------|---------|------------|
| Flags | `--sha <sha>` | `--branch <branch>` |
| CI env | `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, `CI_COMMIT_SHA` | `GITHUB_REF_NAME`, `VERCEL_GIT_COMMIT_REF`, `CI_COMMIT_REF_NAME` |
| Local checkout | `git rev-parse HEAD` | Current branch |
| Synthesized | `local-<random>` (unique per upload) | `local` |

A project with no git at all uploads with zero identity flags:

```bash
storyshelf upload --token $STORYSHELF_TOKEN
# No git checkout detected — using synthetic identity sha=local-a1b2c3d4e5f6 branch="local" (pass --sha/--branch to override)
```

Synthetic shas are unique per upload (satisfying the build identity constraint) and chain baselines like real revisions. The `local` branch keeps local experiments isolated — accepts never touch `main` baselines, and diffing still falls back to the default branch.

## Environments as branches

A branch is a baseline namespace, not necessarily a git branch. Pass an environment name to get isolated baselines per environment:

```bash
storyshelf upload --token $STORYSHELF_TOKEN --sha <run-id> --branch staging
```

Pair with `public_branch_regex` to publish per-environment Storybooks. Accepts on `staging` never affect `main` baselines, and every environment still falls back to the default branch for stories it hasn't baselined itself.

## Checkout-less pipelines

A pipeline that builds the Storybook without cloning — artifact-driven CI, design tools exporting static builds — uploads with explicit values per run:

```bash
storyshelf upload --token $STORYSHELF_TOKEN --sha <run-id> --branch <env>
```

Each unique sha chains baselines normally. Omitting both falls back to synthetic identity (see above); omitting one resolves the other through the same chain.

## What doesn't apply without git

- **Provider status checks and the merge gate.** There is no commit to post to — the server skips git-provider status posts for `local-` shas automatically. No configuration needed.
- **Traced selectivity.** With no history to diff, affected capture renders everything (`not-a-git-repo`, see [Affected capture](/concepts/affected-capture/)). Builds are still fully captured, diffed, and reviewable — just without the skip savings.
- **`doctor` reports it.** `storyshelf doctor` prints a warning (not a failure) when no repository is detected: uploads work, affected capture renders all stories.

## Related

- [Affected capture](/concepts/affected-capture/) — selective rendering and full-render fallbacks
- [Configuration](/guides/config/) — file, flags, and env precedence
- [CI setup](/guides/ci/) — checkout-based pipelines with history
- [Baselines & branches](/concepts/baselines/) — per-branch baseline model
