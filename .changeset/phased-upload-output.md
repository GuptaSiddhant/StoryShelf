---
"storyshelf": minor
---

Changed: `storyshelf upload` reports in timed phases with progress and a summary

`upload`, `doctor` and `server init` open each phase with `==> Checking config` and close it with `--> Checked config (0.4s)`, timed with a monotonic clock. The upload shows `42% of 18.3 MiB` for a zip and `120/860 files` for a file-by-file upload, then prints a summary block (files, size, stories affected out of the total or full capture, build ID, build link). Phase and progress lines go to stderr; results stay on stdout. When stderr is not a terminal, or `CI` is set, there is no spinner, no `\r` and no bar: one line opens and one closes each phase. `NO_COLOR` is respected. Exit codes are unchanged. The unused `postFormWithProgress` export is removed.
