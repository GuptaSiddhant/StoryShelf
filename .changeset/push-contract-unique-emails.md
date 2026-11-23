---
"@storyshelf/core": patch
---

Internal: give each push subscription contract case its own user emails

`pushSubscriptionContractSuite` added every case's users as `a@x.test`, `b@x.test` and `c@x.test`.
A real database keeps one schema across cases and `users.email` is unique, so the MySQL nightly
failed from the second case on with `ER_DUP_ENTRY`. Each user's email now carries its own id.
