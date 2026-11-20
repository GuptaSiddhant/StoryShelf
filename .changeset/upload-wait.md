---
"storyshelf": minor
"@storyshelf/app": minor
---

Added: `storyshelf upload --wait` follows the build and exits by how it ended

After the upload, `--wait` polls the build (every 2 s, backing off to 10 s, honouring `Retry-After`) and prints `==> Publishing`, `==> Capturing 120/860 stories` and the verdict. The wait ends once the build stops needing the server and never waits for a person. Exit codes: `0` approved (including no changes, a skip, or a hosting-only build accepted on publish), `2` changes need review or the Storybook is published and waits for a verdict, `3` rejected, `4` failed (including a failing Storybook test), `5` cancelled or superseded, `6` `--timeout` reached (default 30m). Exit `1` stays the CLI's own errors. The timeout and Ctrl+C stop waiting only; the build is never cancelled. The codes are in `storyshelf upload --help` and on the CLI reference page.

`GET /api/v1/projects/:slug/builds/:buildId` gains two optional fields, `publishing` and `capture` (`{ done, total }`), and the documented `supersededByBuildId`. This is an expand step, so a previous CLI is unaffected. No new route, no schema change.

Schema: none
