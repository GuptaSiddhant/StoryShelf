---
"@storyshelf/db-postgres": minor
---

Added: an rds-iam Postgres preset for RDS IAM authentication

`@storyshelf/db-postgres/rds-iam` connects to RDS or Aurora Postgres with a short-lived IAM token from the optional `@aws-sdk/rds-signer` peer, minted for every new connection so the pool never reuses a stale one. TLS is required, and a missing peer fails at startup with an install hint.
