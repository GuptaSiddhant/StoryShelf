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
      - name: Build Storybook
        run: npx build-storybook -o storybook-static
      - name: Upload to StoryShelf
        run: |
          npx @storyshelf/cli upload \
            --url ${{ secrets.STORYSHELF_URL }} \
            --slug ${{ vars.STORYSHELF_SLUG }} \
            --token ${{ secrets.STORYSHELF_TOKEN }} \
            --sha "$GITHUB_SHA" \
            --branch "$GITHUB_REF_NAME"
```

## GitLab CI

```yaml
visual:
  script:
    - npx build-storybook -o storybook-static
    - npx @storyshelf/cli upload --url "$STORYSHELF_URL" --slug "$STORYSHELF_SLUG" --token "$STORYSHELF_TOKEN" --sha "$CI_COMMIT_SHA" --branch "$CI_COMMIT_REF_NAME"
```

## Merge gate

StoryShelf posts commit statuses per project. To enable them:

1. Register a git provider on the server (see [@storyshelf/git-github](../packages/git-github/)).
2. In the project's **Settings → Git status**, pick the provider, enter a token, and save the repo config.
3. Mark StoryShelf's status check (`storyshelf/<project-slug>` by default) as a required check in your branch protection so PRs can't merge until visual review is approved.

Statuses are `pending` while capture runs, `success` when the build is approved, and `failure` on rejection or capture errors.
