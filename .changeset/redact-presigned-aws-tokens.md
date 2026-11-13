---
"@storyshelf/core": patch
---

Security: redact presigned AWS X-Amz signature, credential and security-token values from error text

`redactSecrets` now removes `X-Amz-Signature`, `X-Amz-Credential` and `X-Amz-Security-Token` query values, so an RDS IAM auth token cannot reach a log, health report or error.
