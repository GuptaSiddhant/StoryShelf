---
"@storyshelf/app": patch
---

A design render fetched with a member's own connection is now served `Cache-Control: private, no-store`, so a browser no longer keeps it after the member signs out. Project-wide renders keep their caching.
