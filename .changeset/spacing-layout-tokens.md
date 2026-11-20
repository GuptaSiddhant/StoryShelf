---
"@storyshelf/app": patch
---

Changed: facade spacing, control heights and card surfaces follow the shared tokens

Padding, margin and gap in the UI facades and shell use `--space-*`; controls use the new `--control-sm` / `--control-md`; titles and the page header carry no margin of their own (the page column and cards set the gap); snapshot, comparison and welcome cards share the `Card` radius and shadow; `StatGroup` keeps stats in a row on narrow screens; breakpoints are limited to 480, 880 and 1024 px. `consistency.test.ts` enforces all of it. `Field` keeps its bottom margin for now. No schema change.
