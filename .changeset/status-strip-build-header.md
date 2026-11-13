---
"@storyshelf/app": patch
---

Changed: the build header is a status strip, and an empty build says why

The build page now opens with a status strip: the status in sentence case, branch, commit, author and age, review or capture progress, and one primary button (Approve remaining, or Retry capture on a failed or cancelled build). Reject all, Open Storybook and Cancel move into the ⋯ menu. A build without snapshots shows a state for its status instead of "capture may still be running": queued, capturing, failed (with the first error line, Retry and Show log), cancelled, published without capture, or no stories. The counts line moved into Build details, which shows non-zero counts only.
