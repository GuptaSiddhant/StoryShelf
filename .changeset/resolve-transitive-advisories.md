---
"@storyshelf/runner-puppeteer": patch
---

Security: drop the vulnerable transitive dependencies `basic-ftp`, `extract-zip` and `zod` 3

`@storyshelf/runner-puppeteer` now requires `puppeteer-core` ^25 (was ^24), whose browser downloader no longer pulls in `basic-ftp` (GHSA-c475-qrg2-pj4r) or `extract-zip` (GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3), and whose BiDi client uses `zod` 4 (GHSA-mrhx-c7xc-m3w5). Schema: none.
