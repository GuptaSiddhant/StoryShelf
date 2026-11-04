---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
---

Changed: the build-reference lifecycle contract no longer has the unfenced `replaceReferences` and `replaceManyReferences`; only the generation-fenced `replaceFencedReferences` and `replaceManyFencedReferences` remain, so no write can bypass the fence. Nothing in StoryShelf called the removed methods; a custom database adapter that implements `buildReferenceLifecycle` must drop them (breaking for such adapters, and the capability is not exposed by any built-in adapter yet). The shared contract suite now also covers stale multi-owner rollback, release keeping the generation, admission to a deleting or missing build, and opposite-order admission.
