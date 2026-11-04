---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Fixed: a build accepted or rejected without its published Storybook no longer shows a permanent pending `storybook` check (#445, #265). With `testing` off, such a build (its content purged or lost, or a legacy row) now shows the `storybook` status as `failure` with `Storybook content unavailable, see build page`, on commit statuses, GitHub check runs (neutral, since it is informational) and GitLab; the build's review card says to re-upload the build or purge it, and a verdict is refused with that text. With `testing` on, capture and publishing run side by side, so a reviewed build can precede its manifest and stays pending. A capture that failed after a successful publish still shows the capture failure with a published Storybook, as before.
