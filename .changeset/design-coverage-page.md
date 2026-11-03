---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

**Added: a design coverage page.** The library header links to **Design coverage**
(`/projects/:slug/design/coverage`) when a design provider is configured. It lists the components of
the latest accepted build with no design link, the linked designs that changed after their baseline
was approved or were deleted (with an Open in the provider link), and how many are up to date, using
only data StoryShelf already stores (no provider call while rendering). Without testing it counts
only links mapped under Settings → Design. (#458)
