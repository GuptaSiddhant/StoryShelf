---
"@storyshelf/core": patch
---

Changed: retention deletes builds skipped from a purged source, and keeps a source they still need

Purging a build now claims every build skipped from it in the same pass, through the same fenced `available` → `deleting` lifecycle, and finishes those first, so a crash resumes without a skipped build outliving its source's rows. A source stays while a skipped build from it is kept (latest on its branch, persistent, or inside the window). Purging a skipped build leaves its source alone (ADR 0044).
