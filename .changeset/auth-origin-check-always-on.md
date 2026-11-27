---
"@storyshelf/auth": patch
---

Security: the sign-in origin check no longer turns off when NODE_ENV=test

The auth library skipped its origin check whenever `NODE_ENV=test`, so a server started with that value accepted a sign-in posted from any origin. The check is now always on (#1436). If you set `NODE_ENV=test` outside tests, upgrade.
