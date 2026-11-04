---
"@storyshelf/core": patch
---

Security hardening: the retention paths that record a build's use of shared content and collect unused content now build their `content/…` keys with the validating `contentKey` helper. A stored value that is not a 64-digit lowercase hex digest is never recorded as a use, never looked up in storage and never deleted; it is skipped, counted, and logged once without its value.
