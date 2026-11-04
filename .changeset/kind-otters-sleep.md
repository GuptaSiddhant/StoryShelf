---
"@storyshelf/core": patch
---

Affected capture renders a story at every viewport when only one viewport's baseline was promoted after the comparison build, instead of also inheriting its other viewports, which wrote the same snapshot twice.
