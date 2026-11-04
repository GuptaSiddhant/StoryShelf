---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Fixed: a build reviewed or accepted without its published Storybook no longer shows a permanent pending `storybook` check (#445, #265). A build past capture (`reviewing`, `approved` or `rejected`) with no manifest and no open `publish` job now shows the `storybook` status as `failure` with `Storybook content unavailable, see build page` (neutral on GitHub check runs, since it is informational); while a publish job is queued, running or exhausting it stays pending, because with `testing` on a capture can finish before publishing does. The build's review card says to re-upload the build or purge it, and a verdict is refused with that text. The queue gains an `onEnded` hook, called after a job reached `done` or `failed`, and the publish job uses it (and tells the build when it is abandoned) so the git state is refreshed once the job has really ended. A capture that failed after a successful publish still shows the capture failure with a published Storybook.
