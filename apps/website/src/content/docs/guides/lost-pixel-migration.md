---
title: Migrating from Lost Pixel
description: Move Lost Pixel Storybook shots to StoryShelf — config mapping, baselines, thresholds, CI, and what is out of scope.
---

[Lost Pixel](https://github.com/lost-pixel/lost-pixel) was sunset in April 2026. StoryShelf covers the same core workflow for Storybook — self-hosted, open source, visual diffs reviewed per pull request — so the Storybook part of a Lost Pixel setup maps over in an afternoon. This guide covers `storybookShots`; see [Scope](#scope) for what does not carry over.

## Concept mapping

| Lost Pixel | StoryShelf |
|------------|------------|
| `storybookShots.storybookUrl` (a local `storybook-static` path or URL) | Upload the built Storybook; the server renders it |
| Lost Pixel runner on CI | Capture runs on the StoryShelf server (Playwright) — no browser in CI |
| `.lostpixel/baseline/` committed (or platform baselines) | Baselines stored on the server, per branch with default-branch fallback |
| `threshold` | `pixel_threshold` / `max_diff_ratio` |
| `breakpoints` | Server `ShelfConfig.viewports` |
| `waitBeforeScreenshot` | Story `parameters.storyshelf.delay` |
| `lostpixel update` (accept) | Approve in the review UI |
| `lostPixelProjectId` / `apiKey` | `STORYSHELF_SLUG` / `STORYSHELF_TOKEN` |

## 1. Deploy a server and create the project

Follow [Getting started](/guides/getting-started/), then create the project:

```bash
storyshelf create --url https://shelf.example.com --name "My Design System" --token $ADMIN_TOKEN
```

## 2. Replace the CI step

Before (Lost Pixel):

```yaml
- run: npx build-storybook -o storybook-static
- run: npx lost-pixel
  env:
    LOST_PIXEL_API_KEY: ${{ secrets.LOST_PIXEL_API_KEY }}
```

After (StoryShelf):

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0 # affected capture diffs against history
- run: npx build-storybook -o storybook-static
- run: npx storyshelf upload --token ${{ secrets.STORYSHELF_TOKEN }} --sha ${{ github.sha }} --branch ${{ github.ref_name }}
  env:
    STORYSHELF_URL: https://shelf.example.com
    STORYSHELF_SLUG: my-design-system
```

Then delete `lostpixel.config.ts` and the Lost Pixel workflow. The [CLI guide](/guides/cli/) and [CI guide](/guides/ci/) cover the full option set and the `.storybook/storyshelf.json` shortcut.

## 3. Baselines

Do not port baseline images. Delete `.lostpixel/baseline/` (and add `.lostpixel/` to `.gitignore`), then run your first upload on the **default branch**: default-branch builds auto-approve and become the baselines. Feature branches diff against them from then on. See [Baselines & branches](/concepts/baselines/).

Lost Pixel's committed-baseline flow has no equivalent step to keep — there is nothing to commit back to the repository.

## 4. Thresholds

Lost Pixel's `threshold` is either a ratio (below 1) or a pixel count. StoryShelf has two knobs, set per project in [Project settings](/guides/project-settings/) or via the API:

- `pixel_threshold` (0–1) — per-pixel color sensitivity (pixelmatch, default 0.1).
- `max_diff_ratio` (0–1) — fraction of differing pixels allowed before a snapshot is `changed` (default 0.01).

Convert a Lost Pixel ratio directly to `max_diff_ratio`. There is no absolute pixel-count threshold; divide by the screenshot's pixel area if you relied on one. Per-story overrides use `parameters.storyshelf.diffThreshold` ([Interaction testing](/guides/interaction-testing/)).

## 5. Viewports, waits, and skipped stories

- **Breakpoints** become the server's `viewports` config.
- **Waits** — set `parameters: { storyshelf: { delay: 300 } }` on a story.
- **Skipped stories** (`shotMode`, `ignoreShots`) — use `parameters.storyshelf.disableSnapshot: true`, or tag the story `flaky-test` to keep it non-blocking.
- **Modes** such as theme or locale matrices — see [Modes](/guides/modes/).

## 6. Masks and ignore regions

**StoryShelf does not support masks or ignore regions.** There is no equivalent of Lost Pixel's `mask` selectors. For dynamic content (dates, avatars, random data):

- make the story deterministic — fixed dates and seeds in `args` or decorators;
- freeze animations via story `delay` and rely on StoryShelf's animation-disabled screenshots;
- raise `max_diff_ratio` or a story's `diffThreshold` as a last resort;
- mark the story `flaky-test` or `disableSnapshot` if it cannot be made stable.

## Scope

StoryShelf is Storybook-only ([ADR 0005](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0005-storybook-only-for-v1.md)). These Lost Pixel modes have **no native equivalent**:

- `pageShots` (full-page URLs)
- `ladleShots`
- `histoireShots`
- `customShots`

If you need page-level shots, keep a small Playwright test for those pages outside StoryShelf, or wrap the page in a Storybook story and let StoryShelf capture it. This is a workaround, not native support. There is also no CLI importer for Lost Pixel configs or baselines.

## Checklist

- ☐ StoryShelf server deployed, project created
- ☐ `STORYSHELF_TOKEN` added to CI secrets; Lost Pixel secrets removed
- ☐ CI step replaced; `lostpixel.config.ts` and `.lostpixel/baseline/` deleted
- ☐ First default-branch build uploaded and baselines established
- ☐ Thresholds, viewports and per-story delays carried over
- ☐ Branch protection requires `storyshelf/<project-slug>` ([Merge gate](/guides/merge-gate/))
