---
"@storyshelf/app": patch
---

Changed: app pages and API answers are gzip-compressed (#868)

HTML pages and `/api/v1` JSON of 1 KB or more are compressed when the client accepts it, with `Vary: Accept-Encoding`. Published files, `/_/`, `/_s/`, `/_r/`, `/_x/`, assets, sign-in, token and credential answers, and answers that set a cookie are never compressed.
