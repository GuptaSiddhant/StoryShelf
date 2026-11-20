---
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Security: the server image can verify a managed database's certificate (`DATABASE_CA`, `DATABASE_CA_FILE`)

With `DATABASE_CA` (PEM text) or `DATABASE_CA_FILE` (a path), the image passes the CA to the Postgres or MySQL adapter, so `sslmode=verify-full` checks the certificate and host name; both set is refused. Without one it behaves as before, and a Postgres URL with `sslmode=require`, `prefer` or `allow` logs one startup warning that the certificate is not verified. `createPostgresDatabase` no longer passes an empty `ssl` key to postgres.js, which switched off the URL's own `sslmode`; `createMysqlDatabase` now applies `ssl` to a URL connection too. The guides recommend `verify-full` and list where each provider's CA comes from. Schema: none.
