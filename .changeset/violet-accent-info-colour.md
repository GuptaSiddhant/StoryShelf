---
"@storyshelf/app": patch
"@storyshelf/core": patch
"storyshelf": patch
---

Changed: violet accent, neutral top bar and a separate info colour

The accent is now indigo-violet (`#5b3fd6` light, `#9d8cff` dark) and the focus ring follows it. The info status keeps its blue (`status.info`, `#1d5fcf` / `#4f8fff`) instead of aliasing the accent, so a status never looks like the brand. The brand packs set `status.info` and no longer set `topbarBg`. The tagline is now "Self-hosted visual testing and review for Storybook."
