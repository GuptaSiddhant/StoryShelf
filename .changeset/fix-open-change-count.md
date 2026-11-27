---
"@storyshelf/core": patch
---

Fixed: the PR comment and check run count the changes that still need review

The stored `changedCount` already holds only the open snapshots, but the notifier subtracted the approved and rejected counts from it again, so a build with unchanged stories said "0 changes to review". The open count is now `changedCount`, and "Review closed" counts the snapshots that were approved. The `on-changes` comment stays after every change is approved.
