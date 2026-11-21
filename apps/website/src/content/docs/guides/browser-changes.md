---
title: When the browser changes
description: Why a new browser version moves pixels, how to see that the capture environment changed, and how to re-baseline a project after an upgrade.
---

A new StoryShelf image, or a new `playwright-core`, usually brings a new Chromium. The same story can then render a few pixels differently with no code change: anti-aliasing, font hinting, scrollbars and gradients all move between browser builds. This page says what StoryShelf does about it today, how to tell it happened, and what to do for one project.

:::note
Automatic environment migration with a kept copy of the previous image and a comparison ([ADR 0038](https://github.com/GuptaSiddhant/StoryShelf/blob/main/docs/adr/0038-environment-migration-and-review.md)) is accepted but not built yet. This page describes only what happens now.
:::

## What StoryShelf does today

Every capture records a **fingerprint** of the environment that rendered it: the engine, the browser build, the platform, the device scale factor and a digest of the installed fonts (for a remote browser the browser reports these itself). The baseline keeps the fingerprint of the capture it came from. When a new capture's fingerprint differs from its baseline's in any of those components, that is an **environment change**:

- **On the default branch** the snapshot is not diffed. It is accepted as `unchanged`, and the baseline is rewritten with the new screenshot and fingerprint. Nobody has to approve anything.
- **On any other branch** the snapshot is still diffed against its baseline. A difference is `changed` and needs review as usual, with a note that it may come from the environment.

A component a capture did not report is unknown, not changed. A viewport size change always diffs, because it comes from story parameters.

The default branch only migrates the stories a build actually **captured**. With [affected capture](/concepts/affected-capture/) on (the default), a build renders only the stories your change touches, so after an upgrade most baselines stay in the old environment until each story is captured again. Until then, feature branches that compare against those stories see environment noise.

Two things this means in practice:

- A real regression that lands on the default branch in the same build as the browser change is masked. Upgrade the browser in its own commit.
- The upgrade can look loud on feature branches, not on the default branch. That is where people re-approve many snapshots.

## See that it happened

Open a build. When any snapshot compared against a baseline from a different environment, the review page shows a **Capture environment changed** notice above the grid:

- On a default-branch build it says how many snapshots were accepted without a pixel diff, which components changed (for example "the browser version changed (130.0 → 131.0)"), and that the baselines were updated.
- On a feature-branch build it says how many snapshots were compared against a baseline from a different environment and names the same components.

Each affected snapshot repeats this above its viewer ("No diff: capture environment changed" on the default branch). If a component could not be compared, the notice says the environment is partly unknown and that nothing migrated because of it.

A feature-branch build is the usual place to notice it: dozens of unrelated stories show tiny diffs at once, and the notice names the browser version.

## Re-baseline one project

Do this once per project after an upgrade that changed the browser.

1. **Confirm the cause.** Open a recent build and read the **Capture environment changed** notice. If it does not appear, the diffs are not an environment change: see [Troubleshooting](/guides/troubleshooting/#diffs-and-baselines).
2. **Capture every story on the default branch.** Run one full upload from the default branch so every baseline migrates in one build, instead of one story at a time as changes touch them:

   ```sh
   npx storyshelf upload --full
   ```

   `--full` renders every story (see [Affected capture](/concepts/affected-capture/)); `SHELF_FULL=1` does the same for a pipeline. The build is accepted without diffs, and its notice says how many snapshots migrated.

3. **Refresh open feature branches.** Builds captured before the migration compare against the old baselines. When a build shows the stale-baseline banner, use **Re-diff against current baselines**: it compares the stored screenshots with the baseline that applies now, without rendering again. Otherwise push a new commit, or use **Retry capture** in the build's menu. Stories that only differed because of the browser come out `unchanged`. A branch that already **accepted** baselines in the old environment keeps comparing against them, because a branch baseline wins over the default branch; accept those snapshots once more on the branch, or merge the branch.
4. **Review what is left.** A diff that remains after steps 2 and 3 is not explained by the browser. Treat it as a real change.

To keep the surprise small, pin the browser: set the `playwright-core` version in the runner and use the matching image tag, so a change is something you choose and not something a rebuild brings. For a remote browser, pin the provider's browser version where the preset has one (see [Remote browsers](/guides/remote-browsers/)).

If the pixel differences are small noise rather than a clean one-time move, `pixel_threshold` and `max_diff_ratio` in project settings tolerate them. That also hides small real changes, so prefer steps 1 to 4.

## How loud is it

One measurement, to set expectations. On 2026-11-20 we rendered every story of StoryShelf's own Storybook (244 stories, 1280 × 720, full page, animations off) with the Chromium that came with Playwright 1.62 (151.0.7922.34) and with the one in Playwright 1.63 (157.0.8103.78), on the same Linux host and fonts, and compared the pairs with pixelmatch (threshold 0.1).

- **21 of 244 stories (9%) differed.** None changed size, and none failed to render.
- The differences were small: at most 60 pixels in a story, about 0.007% of the page. Most were 20 pixels.
- A control run of the older Chromium against itself gave 0 differences, so the 21 come from the browser and not from timing.

With the default `max_diff_ratio` (0.01, one percent of the pixels) all of these would pass as unchanged, and the environment change itself is recorded either way. A project with `max_diff_ratio` set to 0 or close to it would see all 21. This used our own capture settings, not a StoryShelf capture, so treat the counts as an estimate. Your Storybook will differ: text-heavy or gradient-heavy stories move more. This is one pair of versions on one host, not a promise.

## See also

- [Baselines & branches](/concepts/baselines/): how a baseline is chosen.
- [Capture](/concepts/capture/): the fingerprint and its components.
- [Troubleshooting](/guides/troubleshooting/#diffs-and-baselines): other causes of tiny diffs.
- [Baseline portability](/guides/portability/): export baselines before an upgrade if you want a restorable copy.
