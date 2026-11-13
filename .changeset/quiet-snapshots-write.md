---
"@storyshelf/core": patch
---

Changed: a capture writes each snapshot once instead of twice (#858)

A snapshot row is now inserted with its final status and diff result, where it used to be inserted as pending and updated straight after. A passing diff stores no overlay image; a failing one still does, so the UI and API show the same for every snapshot. On the benchmark fixture the snapshot writes of a capture drop from 36 (18 inserts and 18 updates) to 18.
