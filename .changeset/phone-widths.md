---
"@storyshelf/app": patch
---

Fixed: pages no longer scroll sideways on a phone, and the build page's snapshot list folds away

On the build page the snapshot list was one horizontal row whose hidden labels escaped its scroller and widened the page to 3249 px; at 880 px and below it is now a "Snapshots · N to review" toggle over the same vertical list. Tabs and `Segmented` fade at the edge that still scrolls, the active tab opens in view, the builds list filters by status with a select below 480 px, and the builds and devices tables keep their cells on one line. `DocumentLayout` now owns the content width (`form` 880 px, `default` 1200 px, `wide` full), so a page's header, tabs and body share one edge. The three-up stat row stacks at 480 px, not 880 px. Schema: none.
