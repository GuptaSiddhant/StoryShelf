---
"@storyshelf/core": minor
---

Changed: the pull-request comment names the reviewer, failing tests, a11y count and why a capture failed

A delivery now reads the facts the comment already knew how to show: who approved or rejected (their display name in a code span, whitespace collapsed, never an email address or an `@` handle), the failing Storybook tests, the accessibility finding count (a count only; it never moves the headline) and, for a failed capture, a fixed phrase chosen by error class ("a browser failed to start", "timed out", "the Storybook could not be published"). No error text ever reaches the comment. Removed stories and earlier builds follow in a separate issue.

Schema: none
