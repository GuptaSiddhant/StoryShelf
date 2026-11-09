---
"@storyshelf/core": patch
---

Security hardening: the error of a failed remote `connect` keeps only redacted provider text (URLs cut to their origin, Bearer/Basic header values and known secret shapes redacted, at most 300 characters) and no longer carries the thrown value as its cause.
