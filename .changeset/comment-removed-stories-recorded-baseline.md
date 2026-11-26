---
"@storyshelf/core": patch
---

Fixed: the PR comment's removed-stories list uses the baseline the capture recorded

The list read the newest build approved at delivery time, so approving an older build between two deliveries could change it, and it could differ from what the capture compared against. It now reads the build that rendered the baseline images frozen on the build's snapshots (`comparisonMetadata`), so every delivery names the same stories. A build whose capture recorded no baseline shows no list. Schema: none; it reads existing columns.
