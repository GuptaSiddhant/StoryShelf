---
"storyshelf": minor
---

Added: upload --json and build-id/build-url outputs on GitHub Actions

`storyshelf upload --json` prints one JSON object on stdout (`buildId`, `url`, `status`, `skipped`, plus `verdict` and `exitCode` with `--wait`); all human output goes to stderr and exit codes are unchanged. When `GITHUB_OUTPUT` is set, `build-id` and `build-url` are appended to it, with or without `--json`.
