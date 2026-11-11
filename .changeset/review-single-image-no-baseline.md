---
"@storyshelf/app": patch
---

Fixed: the review page shows only the screenshot when a story has no baseline (#933)

A snapshot with no baseline (status `new`, or a reference with no image) now shows its screenshot, the zoom switch and the reason there is no baseline. The mode switch, diff pane, swipe divider and range controls are left out, because none of them does anything without a baseline.
