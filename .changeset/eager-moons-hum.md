---
"storyshelf": patch
"@storyshelf/affected": patch
---

Fixed: a missing baseline commit prints one line instead of git's raw error

When the baseline commit is not in the checkout (a shallow CI clone, or a commit never fetched), `storyshelf upload` prints `Full capture: the baseline commit <short sha> is not in this checkout (shallow clone? fetch more history): rendering all stories` instead of git's multi-line failure. Any other git failure in affected capture keeps only git's first line. The affected package reports a missing baseline as the reason `baseline-not-in-checkout`.
