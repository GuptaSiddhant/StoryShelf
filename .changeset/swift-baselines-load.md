---
"@storyshelf/core": patch
---

Changed: a capture pass loads its baselines in one query instead of one or two per screenshot (#855)

`BaselineModel.loadFor` returns the branch's own baseline, else the default branch's, for every story, viewport and engine of the pass. The pipeline looks each snapshot up in that map; fenced baseline writes are unchanged.
