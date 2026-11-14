---
"@storyshelf/app": patch
---

Changed: published files answer a repeated request with 304 and no storage read

A manifest-backed file is served with `ETag: "<content hash>"` on every route (project path, short links, `/_s/`, `/_r/`), and a request whose `If-None-Match` holds the tag is answered `304` from the cached manifest alone, after the route's access check. A signed answer keeps its own headers, and a refusal is unchanged.
