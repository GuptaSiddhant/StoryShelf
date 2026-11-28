---
"@storyshelf/app": patch
---

Fixed: a comment made with a project token is attributed to the token's owner

`POST /api/v1/projects/{slug}/builds/{buildId}/comments` now attributes a comment to the session user, else to the owner of the bearer token (as verdicts are), instead of storing no author. A token without an owner, and the admin token, still store none, and a token's comment never notifies its own owner. Showing which token made a comment would need a new column and is left out.

Schema: none
