---
"@storyshelf/db": patch
"@storyshelf/app": patch
"create-storyshelf": patch
---

Fixed: Postgres first boot no longer floods NOTICEs, and a failed start names the database

Server notices (`... already exists, skipping`) go to the adapter's logger at debug for postgres.js, `pg` and Neon. A database that fails to start ends with one line naming its host, port and database plus the driver's reason, never the user or password. A `DATABASE_URL` that does not start with `postgres://` or `postgresql://` stops the boot. The scaffold's `.env.example` and next steps show a `DATABASE_URL` example, and describe `SHELF_DATA_DIR` as holding the SQLite file only for a SQLite database.

Schema: none
