---
"@storyshelf/core": patch
---

Security: drop request credentials when an outbound request follows a cross-origin redirect (#1063)

A project-set URL that redirected to another origin used to receive every header of the original request, including `Authorization` and the GitLab `PRIVATE-TOKEN`. A cross-origin hop now keeps only `Accept`, `Accept-Language`, `Content-Type`, `Content-Length` and `User-Agent`; a same-origin redirect keeps all headers. The per-hop outbound check is unchanged.
