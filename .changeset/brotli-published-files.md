---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Added: brotli copies of published files, made when publishing ends (#869)

With `publishedCompression` on, a finished publish now writes a brotli and a gzip copy of each text-like file of 1 KB or more in the background, so the first request is already compressed instead of the second. A client that accepts `br` gets brotli before gzip; each encoding has its own `ETag`, and every answer carries `Vary: Accept-Encoding`. Copies live once per content hash under `derived/published-br/` and `derived/published-gzip/`, and retention deletes them with their content.
