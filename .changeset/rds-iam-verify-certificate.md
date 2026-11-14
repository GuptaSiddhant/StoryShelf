---
"@storyshelf/db-postgres": patch
---

Security: rds-iam verifies the database server certificate by default

`@storyshelf/db-postgres/rds-iam` now checks the server certificate against the Amazon RDS root certificates it bundles, so the IAM token is never sent to an unverified server. `ca` (PEM or an array) replaces the bundle, and `verifyServerCertificate: false` opts out explicitly, which logs a warning.
