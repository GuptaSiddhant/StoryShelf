---
"@storyshelf/db-postgres": patch
"@storyshelf/db-sqlite": patch
---

Fixed: a migration statement that fails now stops the boot. The Postgres and SQLite adapters used to swallow every error from their follow-up ALTERs, index changes and DDL, so a lock timeout or a permission error let boot carry on with a column missing and fail later at run time. Now only the error that says a statement is already done is skipped: a column added by another boot, a column already dropped, and a unique index over rows that already repeat its key (the index is then not built). On SQLite, a `comments` table that still requires a user is now rebuilt for real: the rebuild had never run on node:sqlite (a row read as an object where the connection returns arrays) and copied too few columns everywhere else, and both failures were hidden. It now copies every current column and swaps the table in one transaction.
