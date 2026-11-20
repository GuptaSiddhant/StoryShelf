---
"@storyshelf/runner-puppeteer": minor
---

Breaking: @storyshelf/runner-puppeteer needs puppeteer-core 25

The runner now requires `puppeteer-core` ^25 (was ^24) and passes remote-connection headers as `wsOptions.headers`. Upgrade by installing `puppeteer-core@^25` next to the runner; Puppeteer 24 is no longer supported. Puppeteer 25's browser downloader no longer pulls in `basic-ftp` (GHSA-c475-qrg2-pj4r) or `extract-zip` (GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3), and its BiDi client uses `zod` 4 (GHSA-mrhx-c7xc-m3w5). Schema: none.
