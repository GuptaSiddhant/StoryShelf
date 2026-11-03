---
"storyshelf": patch
---

Fixed: a trailing slash in the server url no longer breaks every request. The url is normalized once (a path prefix is kept), and a server that answers with an HTML page instead of JSON now gets a plain error that names the origin and suggests checking the url.
