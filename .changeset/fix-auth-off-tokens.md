---
"@storyshelf/app": patch
"storyshelf": patch
---

Fixed: a server without sign-in accepts uploads from project tokens

With no auth adapter (development mode), a project token can do what its project allows, so the default scaffold and image receive uploads. A 403 on a token route names the token's role and the role it needs. `GET /api/v1/health` reports `auth`. `storyshelf create` needs no token when the server has sign-in off, and after a failure past project creation it says the project exists and what to do next. The scaffolded `src/index.ts` wires `adminToken` from `STORYSHELF_ADMIN_TOKEN`. `storyshelf doctor` checks that the token may upload.
