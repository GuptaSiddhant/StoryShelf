---
"@storyshelf/app": patch
---

Fixed: Admin → AI usage has no skipped heading level; a command in the root tip breaks only between words

"By day" and "By profile" on Admin → AI usage are now `h2` section titles in cards (they were `h3` straight after the `h1`). The new `Command` facade keeps each token of an inline command whole, so `--name` no longer splits at 375px on the root page.
