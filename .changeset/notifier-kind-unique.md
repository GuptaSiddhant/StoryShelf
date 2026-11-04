---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Fixed: wiring two notifiers that declare the same `metadata.kind` now fails at boot with an error naming both providers (`kind "log" is already used by "…"`), because a stored channel names its provider by kind and the second provider would answer for the first one's channels. Distinct kinds, as in the shipped chat, email and git providers, are unaffected.
