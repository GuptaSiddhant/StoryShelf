---
title: CI setup
description: Run StoryShelf in GitHub Actions and GitLab CI.
---

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
          # On a pull request, check out the PR head rather than the temporary merge commit
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
          fetch-depth: 0 # affected capture diffs against history; a depth of 1 forces full renders
      - name: Build Storybook
        # --stats-json writes preview-stats.json into the output: affected capture reads it
        # (`storyshelf upload` adds it itself when it runs the build script; a step like this one owns the flag)
        run: npx storybook build -o storybook-static --stats-json
      - name: Upload to StoryShelf
        env:
          # On pull_request, GITHUB_SHA is a merge commit and GITHUB_REF_NAME is "<n>/merge": pass
          # the PR head and its branch instead. Through env, because a branch name is user input.
          UPLOAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
          UPLOAD_BRANCH: ${{ github.head_ref || github.ref_name }}
        run: |
          npx storyshelf upload \
            --url ${{ secrets.STORYSHELF_URL }} \
            --slug ${{ vars.STORYSHELF_SLUG }} \
            --token ${{ secrets.STORYSHELF_TOKEN }} \
            --sha "$UPLOAD_SHA" \
            --branch "$UPLOAD_BRANCH"
```

Run `npx storyshelf doctor` after the build to check the setup before uploading. It reports a shallow clone or a missing `preview-stats.json` as a **warning** (the upload still works, rendering every story); fail the step on a warning if you want affected capture to be a requirement.

If you commit `.storybook/storyshelf.json` (url and slug), the `--url` and `--slug` flags can go, and only the token comes from CI (`STORYSHELF_TOKEN`).

## GitLab CI

```yaml
visual:
  variables:
    GIT_DEPTH: 0 # affected capture diffs against history; a shallow clone forces full renders
  script:
    - npx storybook build -o storybook-static --stats-json # the stats file is what affected capture reads
    - npx storyshelf upload --url "$STORYSHELF_URL" --slug "$STORYSHELF_SLUG" --token "$STORYSHELF_TOKEN" --sha "$CI_COMMIT_SHA" --branch "$CI_COMMIT_REF_NAME"
```

## Storybook in a monorepo package

When Storybook lives in a package of the repository (`packages/app`, a workspace), build and upload from that package so affected capture can place the Storybook inside the repository. Keep `fetch-depth: 0` (or `GIT_DEPTH: 0`) on the checkout:

```yaml
- name: Build and upload
  working-directory: packages/app
  run: |
    npx build-storybook -o storybook-static --stats-json
    npx storyshelf upload --url "$STORYSHELF_URL" --slug "$STORYSHELF_SLUG" --token "$STORYSHELF_TOKEN"
```

Changes in the package and in sibling workspace packages it imports both trigger the stories that depend on them. See [Affected capture](/concepts/affected-capture/#storybook-in-a-monorepo-package).

## Merge gate

StoryShelf posts commit statuses per project. To enable them:

1. Register the git providers on the server: `notifications: { notifiers: gitNotifiers }` (see [@storyshelf/notify-git](/packages/notify-git/)).
2. In the project's **Settings → Notifications**, add a git channel: pick the provider, enter the repository, a status prefix and a token.
3. Mark StoryShelf's status check (`storyshelf/testing` by default) as a required check in your branch protection so PRs can't merge until visual review is approved.

For the full walkthrough (GitHub and GitLab rules, multiple projects, verification), see [Merge gate setup](/guides/merge-gate/).

### Default-branch builds are checked with the git host

Any upload token can name any branch, so a build that names the project's default branch counts as a default-branch build (auto-approved, moving the default-branch baselines) only after a git channel confirms the commit is on that branch: GitHub's compare API or GitLab's commit refs, with the channel's own token. A pull request's CI job that uploads with `--branch main` therefore gets a build that needs review, and `storyshelf/testing` stays `pending` with "Commit is not on main" instead of passing.

- If the host says no, or cannot be reached, the build is reviewed like a feature-branch build. The build page says why and offers **Re-check and capture again**.
- Without a git channel the claim is **not verified**, and by default the build needs review too. Connect a GitHub or GitLab channel, or, for a project with no git host, a project admin turns off **Settings → Tests → Verify default-branch builds with the git host** (`requireVerifiedDefault: false`). Its default-branch builds then count unverified, and the System page lists the project.
- **Upgrading:** projects get verification on. A project without a git channel stops auto-approving its default-branch builds until you connect a channel or turn verification off.

`storyshelf/testing` is `pending` while capture runs and review is open, `success` when the build is approved, and `failure` on rejection or capture errors. Without `testing` the gate is `storyshelf/review`: `pending` until an approver approves the build, `success` once approved, `failure` on rejection. `storyshelf/storybook` reports the published Storybook and is informational.
