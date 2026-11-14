---
"storyshelf": minor
---

Added: `storyshelf upload --skip-unchanged` records commits that change no story as skipped builds

With `--skip-unchanged` (config `skipUnchanged`, env `STORYSHELF_SKIP_UNCHANGED=1`) the CLI asks the server for the build to repeat, traces the change against that build's commit, and when no story is affected creates a skipped build instead of uploading the Storybook (ADR 0044, decision 2). Any other outcome, errors included, uploads normally and prints why; `--full` disables skipping. Needs a server with `skippedBuilds` on.
