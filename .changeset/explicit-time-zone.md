---
"@storyshelf/app": patch
---

Fixed: pages render times in UTC and English, not the server's time zone and locale

Build, job, member, token and session times used `toLocale*String()`, so the same data read differently on a UTC container and a laptop. A new `Time` component renders `<time datetime>` with an explicit `en` locale and UTC zone. There is no schema change.
