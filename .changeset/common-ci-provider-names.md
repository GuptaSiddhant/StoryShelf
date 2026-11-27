---
"@storyshelf/common": patch
---

Internal: allow the CI providers' documented variable names in the environment naming ratchet

The CLI reads each provider's own variables to find the commit being built; they are platform names, so they join the unprefixed allow-list. Schema: none.
