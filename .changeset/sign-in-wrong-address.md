---
"@storyshelf/app": patch
"@storyshelf/auth": patch
"@storyshelf/core": patch
---

Fixed: sign-in opened at the wrong address names the configured origin; a bad base URL stops boot

- A sign-in the auth engine refuses because the page was opened at another address than
  `SHELF_PUBLIC_BASE_URL` now says which origin the server is configured for, instead of
  "Invalid credentials". It raises no `sys:auth-failed` and logs one structured line. The origin
  check is unchanged, and wrong passwords stay generic.
- The engine's origin check is now always on: before, it was skipped whenever `NODE_ENV=test`.
- `createShelfAuth` refuses a base URL without `http://` or `https://` with one line naming
  `SHELF_PUBLIC_BASE_URL`, instead of an unhandled rejection with a stack on the first request.
- `ensurePasswordAdmin` names `SHELF_ADMIN_PASSWORD` when the password is too short.
- The `Auth` interface gains an optional `configuredOrigin()`, the origin the engine accepts.
