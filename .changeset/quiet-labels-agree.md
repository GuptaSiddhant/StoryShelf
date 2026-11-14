---
"@storyshelf/app": patch
---

Changed: every status badge reads in sentence case, and only section labels stay uppercase

The compute, library, label, build and review-diff status badges now use `statusLabel` ("Needs review", "Unchanged"). Stat labels are no longer uppercase, and the table header, review panel and sidebar section labels share one size and tracking. The UI consistency test now fails on a card inside a card.
