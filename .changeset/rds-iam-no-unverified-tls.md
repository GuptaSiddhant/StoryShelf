---
"@storyshelf/db-postgres": patch
---

Security: rds-iam never connects without verifying the server certificate

`@storyshelf/db-postgres/rds-iam` verifies against the bundled Amazon RDS roots or the `ca` you give, and the `verifyServerCertificate: false` opt-out is removed: the IAM token is a credential, so there is no way to encrypt without verifying. A blank `ca` is refused. The server image passes `DATABASE_CA` / `DATABASE_CA_FILE` to the IAM path, so there is one way to set a CA.

Schema: none.
