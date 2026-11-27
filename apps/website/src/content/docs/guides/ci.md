---
title: CI setup
description: Run StoryShelf in GitHub Actions and GitLab CI.
---

## One-time setup

Run this once on your machine and commit the file it writes:

```bash
npx storyshelf init --url https://shelf.example.com --slug my-design-system
```

`init` writes `.storybook/storyshelf.json` (url and slug, no secret). From then on a CI step is just `npx storyshelf` with the token in the environment. Bare `storyshelf` is the same command as `storyshelf upload`; it runs when that file exists and otherwise prints help.

## GitHub Actions

```yaml
name: StoryShelf
on: [pull_request, push]

jobs:
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # affected capture diffs against history; a depth of 1 forces full renders
      - name: Build Storybook
        # --stats-json writes preview-stats.json into the output: affected capture reads it
        # (`storyshelf upload` adds it itself when it runs the build script; a step like this one owns the flag)
        run: npx storybook build -o storybook-static --stats-json
      - name: Upload to StoryShelf
        id: upload
        run: npx storyshelf
        env:
          SHELF_TOKEN: ${{ secrets.SHELF_TOKEN }}
      - name: Link the build
        env:
          BUILD_URL: ${{ steps.upload.outputs.build-url }}
        run: echo "Storybook build: $BUILD_URL" >> "$GITHUB_STEP_SUMMARY"
```

The upload step needs no `--sha` or `--branch`, and no `ref:` on the checkout. `storyshelf` reads the run's own environment and the event file GitHub writes (`GITHUB_EVENT_PATH`):

| Event                                | Commit                                  | Branch                              |
| ------------------------------------ | --------------------------------------- | ----------------------------------- |
| `pull_request`, `pull_request_target` | the PR head (`pull_request.head.sha`)   | `GITHUB_HEAD_REF`                   |
| `push`                               | `GITHUB_SHA`                            | `GITHUB_REF_NAME` (the tag for a tag) |
| `merge_group`                        | the queue's head (`merge_group.head_sha`) | the branch it merges into           |

On a pull request GitHub's own `GITHUB_SHA` is a temporary merge commit and `GITHUB_REF_NAME` is `<n>/merge`; neither is used, so builds and statuses land on the commit and branch the PR shows. The commit message and author come from `git log` on that commit (hence `fetch-depth: 0`). `storyshelf doctor` and `storyshelf upload --verbose` (flags go on `upload`) list every value with where it came from. The token is the only secret: keep it in `SHELF_TOKEN`, never in `--token` (arguments show in the process list) and never in `.storybook/storyshelf.json`, which is refused when it holds a `token` key.

On GitHub Actions the upload step sets the outputs `build-id` and `build-url` (read them through `env`, as above). Elsewhere, `storyshelf upload --json` prints `{ "buildId", "url", "status", "skipped" }` on stdout, with every other message on stderr: `npx storyshelf upload --json | jq -r .url`. See [Machine-readable output](/guides/cli/client/#machine-readable-output).

Run `npx storyshelf doctor` after the build to check the setup before uploading. It reports a shallow clone or a missing `preview-stats.json` as a **warning** (the upload still works, rendering every story); fail the step on a warning if you want affected capture to be a requirement. `upload` itself also warns on a shallow clone and never fails because of it.

`SHELF_URL` and `SHELF_SLUG`, when set, take precedence over the committed file (an empty value counts as unset); the token is the only variable a pipeline needs.

## GitLab CI

```yaml
visual:
  variables:
    GIT_DEPTH: 0 # affected capture diffs against history; a shallow clone forces full renders
    # SHELF_TOKEN is a masked CI/CD variable; the CLI reads it from the environment.
  script:
    - npx storybook build -o storybook-static --stats-json # the stats file is what affected capture reads
    - npx storyshelf
```

A merge request pipeline uploads the source branch (`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`) and its head commit (`CI_MERGE_REQUEST_SOURCE_BRANCH_SHA` when GitLab sets it, else `CI_COMMIT_SHA`); a branch pipeline uses `CI_COMMIT_SHA` and `CI_COMMIT_REF_NAME`. The url and slug come from the committed `.storybook/storyshelf.json`.

## Other CI providers

The same two lines work on Vercel, Netlify, CircleCI, Buildkite, Bitbucket Pipelines, Azure Pipelines and Jenkins: check out the full history, set `SHELF_TOKEN`, run `npx storyshelf`. The variables each provider supplies are listed under [Where the commit and branch come from](/guides/cli/client/#where-the-commit-and-branch-come-from). Any other system passes `--sha` and `--branch`, or relies on local git.

## Storybook in a monorepo package

When Storybook lives in a package of the repository (`packages/app`, a workspace), build and upload from that package so affected capture can place the Storybook inside the repository. Keep `fetch-depth: 0` (or `GIT_DEPTH: 0`) on the checkout:

```yaml
- name: Build and upload
  working-directory: packages/app
  run: |
    npx build-storybook -o storybook-static --stats-json
    npx storyshelf # SHELF_TOKEN comes from env; url and slug from this package's .storybook/storyshelf.json
```

Changes in the package and in sibling workspace packages it imports both trigger the stories that depend on them. See [Affected capture](/concepts/affected-capture/#storybook-in-a-monorepo-package).

## Superseded builds

`storyshelf upload` names older in-flight builds of the branch that the new commit replaces, and the project setting `cancel_superseded` lets the server cancel them. Git history decides, so keep `fetch-depth: 0` (or enough depth to reach the previous commits). In a shallow clone a missing commit is kept unless the checked-out commit is the branch's tip on `origin`. See [Builds](/concepts/builds/#superseded-builds).

## Skip commits that change no story

Add `--skip-unchanged` to `storyshelf upload` (or set `SHELF_SKIP_UNCHANGED=1`) and a commit that reaches no story records a skipped build instead of uploading the Storybook, with a status for the commit. It needs the full history (`fetch-depth: 0`) and the build's stats file, like affected capture, and never fails the job: any doubt uploads normally. See [Skipping unchanged commits](/concepts/affected-capture/#skipping-unchanged-commits).

## Merge gate

StoryShelf posts commit statuses per project. To enable them:

1. Nothing to register: the git providers are built in and stay idle until a project adds a git channel (see [Notifications](/guides/notifications/#git-channels-commit-statuses-and-check-runs)).
2. In the project's **Settings → Notifications**, add a git channel: pick the provider, enter the repository, a status prefix and a token.
3. Mark StoryShelf's status check (`storyshelf/testing` by default) as a required check in your branch protection so PRs can't merge until visual review is approved.

For the full walkthrough (GitHub and GitLab rules, multiple projects, verification), see [Merge gate setup](/guides/merge-gate/).

### Default-branch builds are checked with the git host

Any upload token can name any branch, so a build that names the project's default branch counts as a default-branch build (auto-approved, moving the default-branch baselines) only after a git channel confirms the commit is on that branch: GitHub's compare API or GitLab's commit refs, with the channel's own token. A pull request's CI job that uploads with `--branch main` therefore gets a build that needs review, and `storyshelf/testing` stays `pending` with "Commit is not on main" instead of passing.

- If the host says no, or cannot be reached, the build is reviewed like a feature-branch build. The build page says why and offers **Re-check and capture again**.
- Without a git channel the claim is **not verified**, and by default the build needs review too. Connect a GitHub or GitLab channel, or, for a project with no git host, a project admin turns off **Settings → Tests → Verify default-branch builds with the git host** (`requireVerifiedDefault: false`). Its default-branch builds then count unverified, and the System page lists the project.
- **Upgrading:** projects get verification on. A project without a git channel stops auto-approving its default-branch builds until you connect a channel or turn verification off.

`storyshelf/testing` is `pending` while capture runs and review is open, `success` when the build is approved, and `failure` on rejection or capture errors. Without `testing` the gate is `storyshelf/review`: `pending` until an approver approves the build, `success` once approved, `failure` on rejection. `storyshelf/storybook` reports the published Storybook and is informational.
