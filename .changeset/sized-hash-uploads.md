---
"@storyshelf/app": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
---

Fixed: content-hash uploads now record blob sizes, so Insights counts their storage (#1042)

A file-by-file (content-hash) upload, the CLI default, left `content_uses.size_bytes` empty, so the Insights storage card counted most new uploads as "no recorded size". The content route now records each blob's use with the length of the body it just stored, and a blob that was already stored takes the size another use of it recorded, with no blob read.

Schema: none
