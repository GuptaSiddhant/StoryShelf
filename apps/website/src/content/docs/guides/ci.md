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
          fetch-depth: 0 # affected capture diffs against history; a depth of 1 forces full renders
      - name: Build Storybook
        run: npx build-storybook -o storybook-static
      - name: Upload to StoryShelf
        run: |
          npx storyshelf upload \
            --url ${{ secrets.STORYSHELF_URL }} \
            --slug ${{ vars.STORYSHELF_SLUG }} \
            --token ${{ secrets.STORYSHELF_TOKEN }} \
            --sha "$GITHUB_SHA" \
            --branch "$GITHUB_REF_NAME"
```

## GitLab CI

```yaml
visual:
  variables:
    GIT_DEPTH: 0 # affected capture diffs against history; a shallow clone forces full renders
  script:
    - npx build-storybook -o storybook-static
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

`storyshelf/testing` is `pending` while capture runs and review is open, `success` when the build is approved, and `failure` on rejection or capture errors. Without `testing` the gate is `storyshelf/review`: `pending` until an approver approves the build, `success` once approved, `failure` on rejection. `storyshelf/storybook` reports the published Storybook and is informational.
