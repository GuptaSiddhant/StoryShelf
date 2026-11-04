---
"@storyshelf/app": patch
---

UI: every table is a focusable region with its own accessible name ("API tokens", "Members", "Webhooks" and so on), so a keyboard user can scroll a wide table and a screen reader announces which table it is. A table without a name is no longer a landmark, which fixes pages with two tables both announced as "Table". (#571)
