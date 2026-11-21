---
"@storyshelf/core": minor
"@storyshelf/auth": minor
"@storyshelf/app": minor
---

Added: read-only shared accounts that sign in and read but never write

`createShelfAuth({ readOnlyAccounts: ["demo@example.com"] })` (or `SHELF_READ_ONLY_ACCOUNTS` on the server image and the Fly app, comma-separated emails) marks accounts whose password may be published, such as a demo login. Such an account may sign in, sign out and read; every write it attempts is refused with a 403 and one fixed message, by one app middleware for page and API routes (whether it carries the session or a bearer token the account owns) and by a Better Auth `before` hook for the engine's own endpoints, including password resets and email verification that name the account. The connection flow's `GET` start and callback are refused too. Pages show a "Shared demo account: read-only" banner, hide profile, security and comment controls, and list only the visitor's own session. Emails compare after NFKC normalization, and boot warns (without the address) about a listed account with no user. No schema change.
