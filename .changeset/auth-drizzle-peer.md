---
"@storyshelf/auth": patch
---

Fixed: `@storyshelf/auth` no longer requires a `drizzle-orm` peer

Auth has no direct Drizzle import; it reaches Drizzle through `@storyshelf/core/orm`, so installing it no longer asks for a second Drizzle.
